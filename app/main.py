"""
FastAPI OCR web service.

Редактирование:
- Состояние документов и проектов — только через app.storage (ProjectRepo, DocumentRepo).
- Файлы — только через app.files.
- Никаких глобальных in-memory dicts для задач.
- Очередь — только doc_id (str), восстанавливается из БД при старте.
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
    """Количество страниц в PDF через PyMuPDF. Возвращает 0 при ошибке."""
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

# Удерживаем ссылки на background-таски, чтобы GC не собрал их преждевременно.
# Python docs: "Save a reference to the result of asyncio.create_task() to avoid
# a task disappearing mid-execution." Tasks автоматически удаляются из set по
# завершении через done_callback.
_background_tasks: set[asyncio.Task] = set()


def _spawn_bg(coro) -> asyncio.Task:
    """Создать background-таск и удержать ссылку до его завершения."""
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
    asyncio.get_running_loop().run_in_executor(None, ocr_engine.get_engine)
    yield
    # Shutdown — worker и cleanup_loop падают вместе с процессом


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

                def _progress(cur, total):
                    pcent = round(100.0 * cur / total, 1) if total else None
                    cb_conn = _conn()
                    try:
                        DocumentRepo(cb_conn).update(
                            doc_id,
                            current_page=cur,
                            page_count=total,
                            progress_percent=pcent,
                        )
                    finally:
                        cb_conn.close()

                md = await asyncio.to_thread(
                    ocr_engine.process_file,
                    str(original),
                    _progress,
                )
                # ВСЕГДА сохраняем result.md как canonical source.
                # TXT и DOCX генерируются лениво при первом запросе через
                # /api/result|markdown|rendered/{id}?format=...
                files.save_result(DATA_DIR, doc_id, md, "md")

                doc_repo.update(
                    doc_id,
                    status="done",
                    finished_at=_now_iso(),
                    progress_percent=100.0,
                )
                logger.info("Doc %s done: %s", doc_id, doc["filename"])
            except Exception as e:
                logger.exception("Doc %s failed", doc_id)
                doc_repo.update(doc_id, status="error", error=str(e), finished_at=_now_iso())
        finally:
            conn.close()
            task_queue.task_done()


async def orphan_cleanup_loop():
    while True:
        await asyncio.sleep(3600)
        run_orphan_cleanup()


def run_orphan_cleanup() -> dict:
    """Удаляет FS-папки без записи в БД и помечает записи без файлов как error."""
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
    format: str = Form("md"),
    lang: str = Form("ru"),
    project_id: int = Form(INBOX_ID),
):
    """Сохранить файлы как queued документы. НЕ запускает OCR — для этого POST /api/recognize.

    Response shape: {ids: [<created doc ids>], warnings: [], errors: [{filename, error}]}.
    `warnings` заполняется в Task 10 (page-warning для PDF >50 страниц).
    """
    if format not in ("md", "txt", "docx"):
        raise HTTPException(400, "Invalid format. Use md, txt, or docx.")
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
                format=format,
                lang=lang,
                size_bytes=len(content),
            )
            # Page-warning для длинных PDF (Task 10): UI покажет «займёт время».
            # Ошибка PyMuPDF не должна блокировать upload — _pdf_page_count вернёт 0.
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
            # NB: НЕ кладём в task_queue — старт только через POST /api/recognize.
            ids.append(doc_id)
        return {"ids": ids, "warnings": warnings, "errors": errors}
    finally:
        conn.close()


@app.post("/api/recognize")
async def recognize_project(project_id: int):
    """Запустить OCR для всех queued документов проекта.

    Кладёт каждого queued doc_id в task_queue, worker подхватит асинхронно.
    Возвращает {started: <count>, doc_ids: [<list>]}.
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
    }


@app.get("/api/result/{doc_id}")
async def download_result(doc_id: str, format: str | None = None):
    """Download result file. Поддерживает lazy-generation TXT/DOCX из result.md.

    - ?format=md|txt|docx — явный выбор формата.
    - Без format — берёт `documents.format` из БД (backward compat).
    - Если запрошенный формат отсутствует, но result.md есть — генерит из md, сохраняет, отдаёт.
    - Если result.md нет (legacy без md-источника) — 404 для всех кроме фактического формата.
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
    """Вернуть оригинальный файл (PDF/image) для рендера в Source pane.

    Используется frontend Source pane (Task 22) для крупного отображения
    исходника текущего документа.
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
    """Возвращает raw текст результата как text/plain.

    - format='md' (default) → читает result.md.
    - format='txt' → лениво генерит result.txt из result.md, отдаёт.
    - 404 если запрошенный формат недоступен (legacy без md-источника).
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
        # Удаляем FS-папки документов проекта до cascade-delete
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


@app.get("/api/system")
async def system_info():
    from .ocr_engine import _engine
    if _engine is None:
        status = "loading"
    else:
        status = "ready"
    return sys_info.get_system_info(engine_status=status, engine_lang="ru")


@app.get("/api/limits")
async def get_limits():
    """Информация о лимитах для UI (показ заранее)."""
    return {
        "max_file_size_bytes": MAX_FILE_SIZE,
        "allowed_extensions": sorted(ALLOWED_EXTENSIONS),
    }


from . import preview as _preview


@app.get("/api/rendered/{doc_id}")
async def get_rendered(doc_id: str):
    conn = _conn()
    try:
        doc = DocumentRepo(conn).get(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        if doc["status"] != "done":
            raise HTTPException(400, f"Document status: {doc['status']}")
        path = files.result_path(DATA_DIR, doc_id)
        if not path or not path.exists():
            raise HTTPException(404, "Result file missing")
        fmt = doc["format"]
        if fmt == "md":
            html = _preview.markdown_to_html(path.read_text(encoding="utf-8"))
        elif fmt == "txt":
            html = _preview.text_to_html(path.read_text(encoding="utf-8"))
        elif fmt == "docx":
            html = _preview.docx_to_html(path.read_bytes())
        else:
            raise HTTPException(400, f"Unsupported format: {fmt}")
        # Фронтенд читает ответ через `_text(resp)` и вставляет в innerHTML.
        # Возврат JSON ломал бы рендеринг — отдаём raw text/html.
        return HTMLResponse(html, media_type="text/html; charset=utf-8")
    finally:
        conn.close()


@app.get("/api/preview/{doc_id}")
async def preview_pages(doc_id: str):
    import base64
    conn = _conn()
    try:
        doc = DocumentRepo(conn).get(doc_id)
        if not doc:
            raise HTTPException(404, "Document not found")
        original = files.original_path(DATA_DIR, doc_id)
        if not original or not original.exists():
            raise HTTPException(404, "Original missing")
        pages = []
        # DPI/size повышен для Source pane (Task 12+22): браузер downscale через CSS,
        # для thumbnail-баров — норм; для крупного просмотра — нужно sharp.
        if original.suffix.lower() == ".pdf":
            import fitz
            d = fitz.open(str(original))
            for page in d:
                pix = page.get_pixmap(dpi=200)
                pages.append(base64.b64encode(pix.tobytes("jpeg", 80)).decode())
            d.close()
        else:
            from PIL import Image
            import io as _io
            img = Image.open(original)
            img.thumbnail((1600, 1600))
            buf = _io.BytesIO()
            img.save(buf, format="JPEG", quality=80)
            pages.append(base64.b64encode(buf.getvalue()).decode())
        return {"pages": pages}
    finally:
        conn.close()


@app.get("/api/projects/{project_id}/zip")
async def download_project_zip(project_id: int):
    """Скачать архив всех done-документов проекта."""
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

        # Архив собирается целиком в RAM (BytesIO). Допустимо при текущих лимитах
        # MAX_FILE_SIZE × число документов; если проекты вырастут до сотен мегабайт —
        # перейти на SpooledTemporaryFile или генератор-стриминг.
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
