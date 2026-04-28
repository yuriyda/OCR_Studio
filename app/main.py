"""
FastAPI OCR web service.

Maintenance notes:
- Document and project state must only go through app.storage (ProjectRepo, DocumentRepo).
- File operations must only go through app.files.
- No global in-memory dicts for tasks.
- The queue holds only doc_id (str); restored from the database on startup.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Body, FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import db, files, ocr_engine, converters
from . import system as sys_info
from .storage import ProjectRepo, DocumentRepo, ProjectError, INBOX_ID

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 50 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif", ".webp"}

PAGE_WARNING_THRESHOLD = 50


def _pdf_page_count(file_path: str) -> int:
    """Return the page count of a PDF via PyMuPDF. Returns 0 on error."""
    try:
        import fitz
        with fitz.open(file_path) as doc:
            return doc.page_count
    except Exception:
        return 0

DATA_DIR = Path(os.environ.get("OCR_DATA_DIR", "data"))
DB_PATH = DATA_DIR / "data.db"

_STATIC_DIR = Path(__file__).parent / "static"
_DIST_DIR = _STATIC_DIR / "dist"

task_queue: asyncio.Queue = asyncio.Queue()

# Hold references to background tasks so GC does not collect them prematurely.
# Python docs: "Save a reference to the result of asyncio.create_task() to avoid
# a task disappearing mid-execution." Tasks are removed from the set automatically
# on completion via done_callback.
_background_tasks: set[asyncio.Task] = set()


def _spawn_bg(coro) -> asyncio.Task:
    """Create a background task and hold a reference until it completes."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "docs").mkdir(exist_ok=True)
    db.init(DB_PATH)
    conn = _conn()
    try:
        ProjectRepo(conn).ensure_inbox()
        doc_repo = DocumentRepo(conn)
        doc_repo.recover_processing()
        for did in doc_repo.queued_ids_in_order():
            await task_queue.put(did)
    finally:
        conn.close()
    _spawn_bg(worker())
    _spawn_bg(orphan_cleanup_loop())
    asyncio.get_running_loop().run_in_executor(
        None, lambda: ocr_engine.get_engine(DB_PATH)
    )
    yield
    # Shutdown — worker and cleanup_loop exit together with the process


app = FastAPI(title="OCR Service", lifespan=lifespan)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _conn():
    return db.get_connection(DB_PATH)


# --- Worker ---

async def worker():
    while True:
        doc_id = await task_queue.get()
        conn = _conn()
        try:
            doc_repo = DocumentRepo(conn)
            doc = doc_repo.get(doc_id)
            if not doc:
                continue

            doc_repo.update(doc_id, status="processing", started_at=_now_iso())

            try:
                original = files.original_path(DATA_DIR, doc_id)

                # Engine may not be loaded yet (~30 s). Mark stage before the blocking load call.
                if ocr_engine._engine is None:
                    doc_repo.update(doc_id, stage="engine_loading", stage_updated_at=_now_iso())
                    await asyncio.to_thread(ocr_engine.get_engine, DB_PATH)

                doc_repo.update(doc_id, stage="ocr", stage_updated_at=_now_iso())

                def _progress(cur, total):
                    pcent = round(100.0 * cur / total, 1) if total else None
                    cb_conn = _conn()
                    try:
                        DocumentRepo(cb_conn).update(
                            doc_id,
                            current_page=cur,
                            page_count=total,
                            progress_percent=pcent,
                            stage="ocr",
                            stage_updated_at=_now_iso(),
                        )
                    finally:
                        cb_conn.close()

                def _stage(name: str):
                    cb_conn = _conn()
                    try:
                        DocumentRepo(cb_conn).update(
                            doc_id,
                            stage="ocr",
                            stage_detail=name,
                            stage_updated_at=_now_iso(),
                        )
                    finally:
                        cb_conn.close()

                md = await asyncio.to_thread(
                    ocr_engine.process_file,
                    str(original),
                    _progress,
                    _stage,
                )
                # ALWAYS save result.md as the canonical source.
                # TXT and DOCX are generated lazily on first request via
                # /api/result|markdown|rendered/{id}?format=...
                files.save_result(DATA_DIR, doc_id, md, "md")

                doc_repo.update(
                    doc_id,
                    status="done",
                    finished_at=_now_iso(),
                    progress_percent=100.0,
                    stage=None,
                    stage_detail=None,
                    stage_updated_at=_now_iso(),
                )
                logger.info("Doc %s done: %s", doc_id, doc["filename"])
            except Exception as e:
                logger.exception("Doc %s failed", doc_id)
                doc_repo.update(doc_id, status="error", error=str(e),
                                finished_at=_now_iso(),
                                stage=None, stage_detail=None, stage_updated_at=_now_iso())
        finally:
            conn.close()
            task_queue.task_done()


async def orphan_cleanup_loop():
    while True:
        await asyncio.sleep(3600)
        run_orphan_cleanup()


def run_orphan_cleanup() -> dict:
    """Delete FS directories with no matching DB record and mark records with missing files as error."""
    import shutil
    conn = _conn()
    try:
        doc_repo = DocumentRepo(conn)
        db_ids = set(doc_repo.list_all_ids())
        fs_ids = set(files.list_doc_dirs(DATA_DIR))
        removed_fs = 0
        for orphan in fs_ids - db_ids:
            shutil.rmtree(files.doc_dir(DATA_DIR, orphan), ignore_errors=True)
            removed_fs += 1
        marked = 0
        for ghost in db_ids - fs_ids:
            doc = doc_repo.get(ghost)
            if doc and doc["status"] != "error":
                doc_repo.update(ghost, status="error", error="files lost on disk")
                marked += 1
        logger.info("Orphan cleanup: removed %d fs, marked %d ghost", removed_fs, marked)
        return {"removed_fs": removed_fs, "marked_ghost": marked}
    finally:
        conn.close()


# --- Routes ---

@app.get("/")
async def root():
    index = _DIST_DIR / "index.html"
    if not index.exists():
        raise HTTPException(status_code=503, detail="Frontend not built. Run `npm run build`.")
    return FileResponse(str(index))


app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")


@app.post("/api/ocr")
async def upload_files(
    files_in: list[UploadFile] = File(..., alias="files"),
    lang: str = Form("ru"),
    project_id: int = Form(INBOX_ID),
):
    """Save files as queued documents. Does NOT start OCR — use POST /api/recognize for that.

    Response shape: {ids: [<created doc ids>], warnings: [], errors: [{filename, error}]}.
    `warnings` is populated for PDFs with >50 pages (long-processing warning).
    format is always 'md' (canonical); TXT/DOCX are generated lazily via /api/result.
    """
    if lang not in ("ru", "en"):
        raise HTTPException(400, "Invalid language. Use ru or en.")

    conn = _conn()
    try:
        pr = ProjectRepo(conn)
        if pr.get(project_id) is None:
            raise HTTPException(400, f"Project {project_id} not found")
        doc_repo = DocumentRepo(conn)
        ids: list[str] = []
        warnings: list[dict] = []
        errors: list[dict] = []
        for f in files_in:
            ext = Path(f.filename or "file").suffix.lower()
            if ext not in ALLOWED_EXTENSIONS:
                errors.append({"filename": f.filename, "error": f"Unsupported: {ext}"})
                continue
            content = await f.read()
            if len(content) > MAX_FILE_SIZE:
                errors.append({"filename": f.filename, "error": "File too large (max 50 MB)"})
                continue
            doc_id = uuid.uuid4().hex[:12]
            files.save_original(DATA_DIR, doc_id, content, f.filename or "file")
            doc_repo.create(
                doc_id=doc_id,
                project_id=project_id,
                filename=Path(f.filename or "file").name,
                format="md",  # ALWAYS md (canonical); TXT/DOCX are generated lazily
                lang=lang,
                size_bytes=len(content),
            )
            # Page warning for long PDFs: UI will indicate "this will take a while".
            # A PyMuPDF error must not block the upload — _pdf_page_count returns 0 on failure.
            if ext == ".pdf":
                try:
                    saved_path = files.original_path(DATA_DIR, doc_id)
                    if saved_path is not None:
                        page_count = _pdf_page_count(str(saved_path))
                        if page_count > PAGE_WARNING_THRESHOLD:
                            warnings.append({
                                "id": doc_id,
                                "type": "long_processing",
                                "pages": page_count,
                            })
                except Exception:
                    pass
            # NB: NOT added to task_queue — OCR starts only via POST /api/recognize.
            ids.append(doc_id)
        return {"ids": ids, "warnings": warnings, "errors": errors}
    finally:
        conn.close()


@app.post("/api/recognize")
async def recognize_project(project_id: int):
    """Start OCR for all queued documents in the project.

    Puts each queued doc_id into task_queue; worker picks them up asynchronously.
    Returns {started: <count>, doc_ids: [<list>]}.
    """
    conn = _conn()
    try:
        pr = ProjectRepo(conn)
        if pr.get(project_id) is None:
            raise HTTPException(404, f"Project {project_id} not found")
        doc_repo = DocumentRepo(conn)
        queued = doc_repo.queued_in_project(project_id)
        started_ids: list[str] = []
        for doc in queued:
            await task_queue.put(doc["id"])
            started_ids.append(doc["id"])
        return {"started": len(started_ids), "doc_ids": started_ids}
    finally:
        conn.close()


@app.get("/api/status")
async def status(project_id: int | None = None, sort: str = "created", order: str = "desc"):
    conn = _conn()
    try:
        doc_repo = DocumentRepo(conn)
        return [_doc_response(d) for d in doc_repo.list(project_id=project_id, sort=sort, order=order)]
    finally:
        conn.close()


def _doc_response(d: dict) -> dict:
    elapsed = None
    eta = None
    if d.get("started_at"):
        try:
            started = datetime.fromisoformat(d["started_at"])
            now = datetime.now(timezone.utc)
            elapsed = max(0, int((now - started).total_seconds()))
            if d.get("status") == "processing" and d.get("progress_percent"):
                pcent = float(d["progress_percent"])
                if 0 < pcent < 100:
                    total_estimate = elapsed * (100.0 / pcent)
                    eta = max(0, int(total_estimate - elapsed))
        except (ValueError, TypeError):
            pass
    stage = d.get("stage")
    stage_label = None
    if stage == "engine_loading":
        stage_label = "Загрузка моделей PaddleOCR: layout, text, table, formula"
    elif stage == "ocr":
        page_part = ""
        if d.get("current_page") and d.get("page_count"):
            page_part = f"страница {d['current_page']}/{d['page_count']}"
        detail = d.get("stage_detail")
        if page_part and detail:
            stage_label = f"{page_part}: {detail}"
        elif page_part:
            stage_label = f"PPStructureV3 — {page_part}"
        elif detail:
            stage_label = f"PPStructureV3: {detail}"
        else:
            stage_label = "PPStructureV3 (cyrillic)"
    return {
        "id": d["id"],
        "filename": d["filename"],
        "project_id": d["project_id"],
        "status": d["status"],
        "format": d["format"],
        "lang": d["lang"],
        "error": d["error"],
        "created_at": d["created_at"],
        "started_at": d["started_at"],
        "finished_at": d["finished_at"],
        "page_count": d["page_count"],
        "current_page": d["current_page"],
        "progress_percent": d["progress_percent"],
        "size_bytes": d["size_bytes"],
        "elapsed_seconds": elapsed,
        "eta_seconds": eta,
        "available_formats": files.available_formats(DATA_DIR, d["id"]),
        "stage": stage,
        "stage_detail": d.get("stage_detail"),
        "stage_label": stage_label,
    }


@app.get("/api/result/{doc_id}")
async def download_result(doc_id: str, format: str | None = None):
    """Download result file. Supports lazy generation of TXT/DOCX from result.md.

    - ?format=md|txt|docx — explicit format selection.
    - Without format — uses `documents.format` from the database (backward compat).
    - If the requested format is absent but result.md exists — generates from md, saves, returns.
    - If result.md is absent (legacy without md source) — 404 for all formats except the native one.
    """
    conn = _conn()
    try:
        doc = DocumentRepo(conn).get(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        if doc["status"] != "done":
            raise HTTPException(400, f"Document status: {doc['status']}")

        requested = format or doc["format"]
        if requested not in files.SUPPORTED_RESULT_FORMATS:
            raise HTTPException(400, f"Invalid format: {requested}")

        path = files.result_path_for_format(DATA_DIR, doc_id, requested)
        if path is None:
            md_path = files.result_path_for_format(DATA_DIR, doc_id, "md")
            if md_path is None:
                raise HTTPException(404, f"Format '{requested}' not available; no markdown source for legacy document")
            md_text = md_path.read_text(encoding="utf-8")
            if requested == "txt":
                path = files.save_result(DATA_DIR, doc_id, converters.md_to_txt(md_text), "txt")
            elif requested == "docx":
                path = files.save_result(DATA_DIR, doc_id, converters.md_to_docx(md_text), "docx")
            else:
                raise HTTPException(404, "Result file missing")

        media = {
            "md": "text/markdown; charset=utf-8",
            "txt": "text/plain; charset=utf-8",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }
        return FileResponse(str(path), filename=path.name, media_type=media[requested])
    finally:
        conn.close()


@app.get("/api/source/{doc_id}")
async def get_source(doc_id: str):
    """Return the original file (PDF/image) for rendering in the Source pane.

    Used by the frontend Source pane to display the current document at full size.
    """
    conn = _conn()
    try:
        doc = DocumentRepo(conn).get(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        src_path = files.original_path(DATA_DIR, doc_id)
        if not src_path or not src_path.exists():
            raise HTTPException(404, "Source file missing on disk")
        return FileResponse(str(src_path), filename=doc["filename"])
    finally:
        conn.close()


@app.get("/api/markdown/{doc_id}")
async def get_markdown(doc_id: str, format: str = "md"):
    """Return the raw result text as text/plain.

    - format='md' (default) → reads result.md.
    - format='txt' → lazily generates result.txt from result.md and returns it.
    - 404 if the requested format is unavailable (legacy without md source).
    """
    if format not in ("md", "txt"):
        raise HTTPException(400, f"Invalid format for markdown endpoint: {format}")
    conn = _conn()
    try:
        doc = DocumentRepo(conn).get(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        if doc["status"] != "done":
            raise HTTPException(400, f"Document status: {doc['status']}")

        path = files.result_path_for_format(DATA_DIR, doc_id, format)
        if path is None:
            if format == "txt":
                md_path = files.result_path_for_format(DATA_DIR, doc_id, "md")
                if md_path is None:
                    raise HTTPException(404, "No markdown source for txt conversion")
                txt = converters.md_to_txt(md_path.read_text(encoding="utf-8"))
                path = files.save_result(DATA_DIR, doc_id, txt, "txt")
            else:
                raise HTTPException(404, f"Format '{format}' not available")

        text = path.read_text(encoding="utf-8")
        return PlainTextResponse(text, media_type="text/plain; charset=utf-8")
    finally:
        conn.close()


# --- Projects CRUD ---

@app.get("/api/projects")
async def list_projects():
    conn = _conn()
    try:
        pr = ProjectRepo(conn)
        doc_repo = DocumentRepo(conn)
        result = []
        for p in pr.list():
            docs = doc_repo.list(project_id=p["id"])
            result.append({
                "id": p["id"],
                "name": p["name"],
                "created_at": p["created_at"],
                "doc_count": len(docs),
                "total_bytes": doc_repo.total_bytes(p["id"]),
            })
        return result
    finally:
        conn.close()


@app.post("/api/projects")
async def create_project(payload: dict = Body(...)):
    conn = _conn()
    try:
        try:
            p = ProjectRepo(conn).create(payload.get("name", ""))
        except ProjectError as e:
            msg = str(e)
            code = 409 if "exists" in msg else 400
            raise HTTPException(code, msg)
        return {**p, "doc_count": 0, "total_bytes": 0}
    finally:
        conn.close()


@app.patch("/api/projects/{project_id}")
async def rename_project(project_id: int, payload: dict = Body(...)):
    conn = _conn()
    try:
        try:
            ProjectRepo(conn).rename(project_id, payload.get("name", ""))
        except ProjectError as e:
            msg = str(e)
            if "Inbox" in msg:
                raise HTTPException(400, msg)
            code = 409 if "exists" in msg else 400
            raise HTTPException(code, msg)
        p = ProjectRepo(conn).get(project_id)
        doc_repo = DocumentRepo(conn)
        return {
            **p,
            "doc_count": len(doc_repo.list(project_id=project_id)),
            "total_bytes": doc_repo.total_bytes(project_id),
        }
    finally:
        conn.close()


@app.delete("/api/projects/{project_id}", status_code=204)
async def delete_project(project_id: int):
    conn = _conn()
    try:
        pr = ProjectRepo(conn)
        if pr.get(project_id) is None:
            raise HTTPException(404, "Project not found")
        doc_repo = DocumentRepo(conn)
        processing = [d for d in doc_repo.list(project_id=project_id) if d["status"] == "processing"]
        if processing:
            raise HTTPException(409, "project has processing documents, wait")
        # Delete document FS directories before the cascade-delete
        for d in doc_repo.list(project_id=project_id):
            files.delete_doc_dir(DATA_DIR, d["id"])
        try:
            pr.delete(project_id)
        except ProjectError as e:
            raise HTTPException(400, str(e))
    finally:
        conn.close()


@app.patch("/api/documents/{doc_id}")
async def patch_document(doc_id: str, payload: dict = Body(...)):
    conn = _conn()
    try:
        doc_repo = DocumentRepo(conn)
        doc = doc_repo.get(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        if "project_id" in payload:
            new_pid = int(payload["project_id"])
            if ProjectRepo(conn).get(new_pid) is None:
                raise HTTPException(400, f"Project {new_pid} not found")
            doc_repo.move(doc_id, new_pid)
        return _doc_response(doc_repo.get(doc_id))
    finally:
        conn.close()


@app.delete("/api/documents/{doc_id}", status_code=204)
async def delete_document(doc_id: str):
    conn = _conn()
    try:
        doc_repo = DocumentRepo(conn)
        doc = doc_repo.get(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        if doc["status"] == "processing":
            raise HTTPException(409, "document is being processed, wait")
        doc_repo.delete(doc_id)
        files.delete_doc_dir(DATA_DIR, doc_id)
    finally:
        conn.close()


# --- Re-OCR ---

def _reset_doc_for_reocr(conn, doc_id: str) -> dict:
    """Clear result files, reset DB fields to queued state."""
    files.delete_results(DATA_DIR, doc_id)
    DocumentRepo(conn).update(
        doc_id,
        status="queued",
        error=None,
        progress_percent=None,
        current_page=None,
        page_count=None,
        finished_at=None,
        started_at=None,
        stage=None,
        stage_detail=None,
        stage_updated_at=None,
    )
    return DocumentRepo(conn).get(doc_id)


@app.post("/api/documents/{doc_id}/reocr")
async def reocr_document(doc_id: str):
    conn = _conn()
    try:
        doc_repo = DocumentRepo(conn)
        doc = doc_repo.get(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        if doc["status"] != "done":
            raise HTTPException(400, "Only completed documents can be re-OCR'd")
        updated = _reset_doc_for_reocr(conn, doc_id)
    finally:
        conn.close()
    await task_queue.put(doc_id)
    return _doc_response(updated)


@app.post("/api/projects/{project_id}/reocr")
async def reocr_project(project_id: int):
    conn = _conn()
    try:
        if ProjectRepo(conn).get(project_id) is None:
            raise HTTPException(404, "Project not found")
        doc_repo = DocumentRepo(conn)
        done_docs = [d for d in doc_repo.list(project_id=project_id) if d["status"] == "done"]
        ids = [d["id"] for d in done_docs]
        for did in ids:
            _reset_doc_for_reocr(conn, did)
    finally:
        conn.close()
    for did in ids:
        await task_queue.put(did)
    return {"requeued": len(ids), "doc_ids": ids}


# --- Settings + Onboarding ---

from .settings import SettingsRepo as _SettingsRepo, HQ_KEYS as _HQ_KEYS

# Holds the latest reload progress snapshot. New SSE subscribers receive this
# immediately on connect so a brief network drop doesn't lose the final event.
_reload_state: dict = {"loaded": 0, "total": 0, "current": None, "done": True, "error": None}


@app.get("/api/settings")
async def get_settings():
    conn = _conn()
    try:
        repo = _SettingsRepo(conn)
        cfg = repo.get_hq_config()
        cfg["onboarding_seen"] = repo.is_onboarding_seen()
        return cfg
    finally:
        conn.close()


def _processing_doc_ids() -> list[str]:
    conn = _conn()
    try:
        return [d["id"] for d in DocumentRepo(conn).list() if d["status"] == "processing"]
    finally:
        conn.close()


@app.put("/api/settings")
async def put_settings(payload: dict = Body(...)):
    queue_size = task_queue.qsize()
    processing = _processing_doc_ids()
    if queue_size > 0 or processing:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "queue_not_empty",
                "queue_size": queue_size,
                "processing": processing,
            },
        )

    cleaned = {k: bool(v) for k, v in payload.items() if k in _HQ_KEYS}

    conn = _conn()
    try:
        _SettingsRepo(conn).set_hq_config(cleaned)
    finally:
        conn.close()

    # Reset shared reload state and kick reload off in the background.
    _reload_state.update({"loaded": 0, "total": 0, "current": None, "done": False, "error": None})

    def _on_progress(loaded, total, current):
        _reload_state.update({"loaded": loaded, "total": total, "current": current})

    def _on_done():
        _reload_state.update({"done": True})

    def _on_error(exc):
        _reload_state.update({"done": True, "error": str(exc)})

    _spawn_bg(ocr_engine.reload_engine_async(DB_PATH, _on_progress, _on_done, _on_error))
    return {"status": "reloading"}


@app.post("/api/settings/onboarding/dismiss", status_code=204)
async def dismiss_onboarding():
    conn = _conn()
    try:
        _SettingsRepo(conn).mark_onboarding_seen()
    finally:
        conn.close()


@app.get("/api/settings/reload-stream")
async def settings_reload_stream():
    """Server-Sent Events stream of engine-reload progress.

    On connect, immediately emits the current snapshot so a fresh subscriber
    after a network drop doesn't miss the final event. Closes the stream once
    the snapshot is in a terminal state (done=True) for two consecutive ticks.
    """
    from fastapi.responses import StreamingResponse
    import json

    async def event_gen():
        # Initial snapshot — sent immediately on connect
        yield f"data: {json.dumps(_reload_state)}\n\n"
        last_sent = dict(_reload_state)
        terminal_ticks = 0
        while True:
            await asyncio.sleep(0.25)
            current = dict(_reload_state)
            if current != last_sent:
                yield f"data: {json.dumps(current)}\n\n"
                last_sent = current
            if current.get("done"):
                terminal_ticks += 1
                if terminal_ticks >= 2:
                    break

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@app.get("/api/system")
async def system_info():
    from .ocr_engine import _engine, PIPELINE_MODELS
    if _engine is None:
        status = "loading"
    else:
        status = "ready"
    return sys_info.get_system_info(
        engine_status=status,
        engine_lang="ru",
        engine_pipeline=PIPELINE_MODELS,
    )


@app.get("/api/limits")
async def get_limits():
    """Limits information for the UI (shown proactively)."""
    return {
        "max_file_size_bytes": MAX_FILE_SIZE,
        "allowed_extensions": sorted(ALLOWED_EXTENSIONS),
    }


from . import preview as _preview


@app.get("/api/rendered/{doc_id}")
async def get_rendered(doc_id: str, format: str = "md"):
    """Return rendered HTML for viewing in the Result pane.

    - format='md'   → markdown library + bleach sanitizer.
    - format='docx' → mammoth(result.docx). If result.docx is absent — lazily
                       generates from result.md via converters.md_to_docx.
    - 404 if the required source is unavailable.
    """
    if format not in ("md", "docx"):
        raise HTTPException(400, f"Invalid format for rendered endpoint: {format}")
    conn = _conn()
    try:
        doc = DocumentRepo(conn).get(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        if doc["status"] != "done":
            raise HTTPException(400, f"Document status: {doc['status']}")

        if format == "md":
            md_path = files.result_path_for_format(DATA_DIR, doc_id, "md")
            if md_path is None:
                raise HTTPException(404, "No markdown source available")
            html = _preview.markdown_to_html(md_path.read_text(encoding="utf-8"))
            # Frontend reads the response via `_text(resp)` and inserts it into innerHTML.
            # Returning JSON would break rendering — send raw text/html.
            return HTMLResponse(html, media_type="text/html; charset=utf-8")

        # format == "docx"
        docx_path = files.result_path_for_format(DATA_DIR, doc_id, "docx")
        if docx_path is None:
            # Lazy generation from result.md
            md_path = files.result_path_for_format(DATA_DIR, doc_id, "md")
            if md_path is None:
                raise HTTPException(404, "No source for docx generation")
            md_text = md_path.read_text(encoding="utf-8")
            docx_path = files.save_result(DATA_DIR, doc_id, converters.md_to_docx(md_text), "docx")
        html = _preview.docx_to_html(docx_path.read_bytes())
        return HTMLResponse(html, media_type="text/html; charset=utf-8")
    finally:
        conn.close()


@app.get("/api/preview/{doc_id}/info")
async def preview_info(doc_id: str):
    """Preview metadata without rendering. Cheap — reads only page_count via PyMuPDF."""
    from . import preview_render
    conn = _conn()
    try:
        doc = DocumentRepo(conn).get(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        original = files.original_path(DATA_DIR, doc_id)
        if not original or not original.exists():
            raise HTTPException(404, "Original missing")
        kind = "pdf" if original.suffix.lower() == ".pdf" else "image"
        if kind == "pdf":
            import fitz
            with fitz.open(str(original)) as pdf:
                count = pdf.page_count
        else:
            count = 1
        progress = preview_render.get_progress(doc_id)
        return {"count": count, "kind": kind, "thumbs_progress": progress}
    finally:
        conn.close()


@app.get("/api/preview/{doc_id}/thumbs")
async def preview_thumbs(doc_id: str):
    """All thumbnails as base64 JSON (compact DPI=80)."""
    import base64
    from . import preview_render
    conn = _conn()
    try:
        doc = DocumentRepo(conn).get(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        try:
            paths = preview_render.render_thumbs(DATA_DIR, doc_id)
        except FileNotFoundError:
            raise HTTPException(404, "Original missing")
        pages = [base64.b64encode(p.read_bytes()).decode() for p in paths]
        return {"pages": pages}
    finally:
        conn.close()


@app.get("/api/preview/{doc_id}/page/{page_num}")
async def preview_page(doc_id: str, page_num: int):
    """Full-resolution page as JPEG bytes."""
    from . import preview_render
    conn = _conn()
    try:
        doc = DocumentRepo(conn).get(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        try:
            path = preview_render.render_page(DATA_DIR, doc_id, page_num)
        except FileNotFoundError:
            raise HTTPException(404, "Original missing")
        except ValueError as e:
            raise HTTPException(404, str(e))
        return FileResponse(
            str(path),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=3600"},
        )
    finally:
        conn.close()


@app.get("/api/projects/{project_id}/zip")
async def download_project_zip(project_id: int):
    """Download a ZIP archive of all completed documents in the project."""
    import io
    import zipfile
    from fastapi.responses import StreamingResponse

    conn = _conn()
    try:
        pr = ProjectRepo(conn)
        project = pr.get(project_id)
        if project is None:
            raise HTTPException(404, "Project not found")
        doc_repo = DocumentRepo(conn)
        done_docs = [d for d in doc_repo.list(project_id=project_id) if d["status"] == "done"]
        if not done_docs:
            raise HTTPException(404, "No completed documents in project")

        # The archive is assembled entirely in RAM (BytesIO). Acceptable at current limits
        # of MAX_FILE_SIZE × number of documents; if projects grow to hundreds of MB,
        # switch to SpooledTemporaryFile or a streaming generator.
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            seen_names: set[str] = set()
            for d in done_docs:
                path = files.result_path(DATA_DIR, d["id"])
                if not path or not path.exists():
                    logger.warning("doc %s status=done but result file missing — skipped from zip", d["id"])
                    continue
                stem = Path(d["filename"]).stem
                arcname = f"{stem}{path.suffix}"
                counter = 1
                while arcname in seen_names:
                    arcname = f"{stem}_{counter}{path.suffix}"
                    counter += 1
                seen_names.add(arcname)
                zf.write(path, arcname=arcname)
        buf.seek(0)

        safe_proj = "".join(c if c.isalnum() or c in "-_" else "_" for c in project["name"])
        filename = f"{safe_proj}.zip"
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    finally:
        conn.close()
