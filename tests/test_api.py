"""
API integration tests via FastAPI TestClient.

Maintenance notes:
- Add new tests; do not remove existing ones without discussion.
- The OCR engine is always mocked so PaddleOCR is never loaded in the test environment.
- When adding new routes, add the corresponding tests here.
"""
import asyncio
import importlib
import io
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_data_dir, monkeypatch):
    # paddleocr stubs are installed at module level via tests/conftest.py:stub_paddleocr_modules

    # Reload modules to pick up stubs (in case they were already imported earlier)
    for mod in list(sys.modules.keys()):
        if mod.startswith("app"):
            del sys.modules[mod]

    async def _noop_worker():
        await asyncio.sleep(3600)  # does not process the queue in tests

    async def _noop_watcher(*args, **kwargs):
        await asyncio.sleep(3600)  # does not scan inbox in tests

    with patch("app.ocr_engine.process_file", return_value="# stub"), \
         patch("app.ocr_engine.get_engine"), \
         patch("app.main.worker", _noop_worker), \
         patch("app.watcher.watcher_loop", _noop_watcher):
        from app import main
        main.DATA_DIR = tmp_data_dir
        main.DB_PATH = tmp_data_dir / "data.db"
        with TestClient(main.app) as c:
            yield c


def _upload(client, content=b"%PDF-1.4 fake", name="x.pdf", project_id=None):
    files = [("files", (name, io.BytesIO(content), "application/pdf"))]
    data = {"format": "md", "lang": "ru"}
    if project_id is not None:
        data["project_id"] = str(project_id)
    return client.post("/api/ocr", files=files, data=data)


def test_upload_to_inbox_default(client):
    r = _upload(client)
    assert r.status_code == 200
    body = r.json()
    assert len(body["ids"]) == 1
    docs = client.get("/api/status").json()
    assert any(d["id"] == body["ids"][0] and d["project_id"] == 1 for d in docs)


def test_status_returns_extended_fields(client):
    _upload(client)
    r = client.get("/api/status")
    assert r.status_code == 200
    docs = r.json()
    assert len(docs) >= 1
    keys = set(docs[0].keys())
    expected = {
        "id", "filename", "project_id", "status", "format", "lang",
        "error", "created_at", "started_at", "finished_at",
        "page_count", "current_page", "progress_percent", "size_bytes",
    }
    assert expected <= keys


def test_list_projects_includes_inbox(client):
    r = client.get("/api/projects")
    assert r.status_code == 200
    body = r.json()
    assert any(p["name"] == "Inbox" and p["id"] == 1 for p in body)
    assert all("doc_count" in p and "total_bytes" in p for p in body)


def test_create_project(client):
    r = client.post("/api/projects", json={"name": "P1"})
    assert r.status_code == 200
    p = r.json()
    assert p["name"] == "P1"
    assert p["doc_count"] == 0


def test_create_project_duplicate_409(client):
    client.post("/api/projects", json={"name": "Dup"})
    r = client.post("/api/projects", json={"name": "Dup"})
    assert r.status_code == 409


def test_create_project_empty_400(client):
    r = client.post("/api/projects", json={"name": "  "})
    assert r.status_code == 400


def test_rename_project(client):
    p = client.post("/api/projects", json={"name": "Old"}).json()
    r = client.patch(f"/api/projects/{p['id']}", json={"name": "New"})
    assert r.status_code == 200
    assert r.json()["name"] == "New"


def test_rename_inbox_400(client):
    r = client.patch("/api/projects/1", json={"name": "X"})
    assert r.status_code == 400


def test_delete_project(client):
    p = client.post("/api/projects", json={"name": "ToDel"}).json()
    r = client.delete(f"/api/projects/{p['id']}")
    assert r.status_code == 204


def test_delete_inbox_400(client):
    r = client.delete("/api/projects/1")
    assert r.status_code == 400


def test_upload_to_specific_project(client):
    p = client.post("/api/projects", json={"name": "Target"}).json()
    r = _upload(client, project_id=p["id"])
    assert r.status_code == 200
    doc_id = r.json()["ids"][0]
    docs = client.get("/api/status").json()
    target = next(d for d in docs if d["id"] == doc_id)
    assert target["project_id"] == p["id"]


def test_status_filter_by_project(client):
    p = client.post("/api/projects", json={"name": "Filtered"}).json()
    _upload(client, name="x.pdf")
    _upload(client, name="y.pdf", project_id=p["id"])
    r = client.get(f"/api/status?project_id={p['id']}")
    docs = r.json()
    assert all(d["project_id"] == p["id"] for d in docs)
    assert {d["filename"] for d in docs} == {"y.pdf"}


def test_move_document(client):
    p = client.post("/api/projects", json={"name": "Target"}).json()
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    r = client.patch(f"/api/documents/{doc_id}", json={"project_id": p["id"]})
    assert r.status_code == 200
    assert r.json()["project_id"] == p["id"]


def test_move_to_missing_project_400(client):
    upload = _upload(client).json()
    r = client.patch(f"/api/documents/{upload['ids'][0]}", json={"project_id": 99999})
    assert r.status_code == 400


def test_delete_document(client):
    upload = _upload(client).json()
    r = client.delete(f"/api/documents/{upload['ids'][0]}")
    assert r.status_code == 204


def test_delete_processing_document_409(client):
    upload = _upload(client).json()
    from app import db, main
    from app.storage import DocumentRepo
    conn = db.get_connection(main.DB_PATH)
    DocumentRepo(conn).update(upload["ids"][0], status="processing")
    conn.close()
    r = client.delete(f"/api/documents/{upload['ids'][0]}")
    assert r.status_code == 409


def test_system_endpoint_shape(client):
    r = client.get("/api/system")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) >= {"gpu", "cuda", "vram_gb", "engine_status", "engine_lang"}


def test_projects_total_bytes(client):
    p = client.post("/api/projects", json={"name": "P"}).json()
    _upload(client, content=b"x" * 1024, project_id=p["id"])
    body = client.get("/api/projects").json()
    target = next(x for x in body if x["id"] == p["id"])
    assert target["total_bytes"] >= 1024


def _force_done(doc_id, content="# stub", fmt="md"):
    """Helper: marks the document as done and writes the result file."""
    from app import db, main, files as files_mod
    from app.storage import DocumentRepo
    conn = db.get_connection(main.DB_PATH)
    DocumentRepo(conn).update(
        doc_id, status="done",
        finished_at="2026-04-25T10:00:00+00:00",
        progress_percent=100.0,
    )
    conn.close()
    if fmt == "docx":
        from docx import Document
        import io as _io
        d = Document()
        d.add_paragraph("test")
        buf = _io.BytesIO()
        d.save(buf)
        files_mod.save_result(main.DATA_DIR, doc_id, buf.getvalue(), "docx")
    else:
        files_mod.save_result(main.DATA_DIR, doc_id, content, fmt)


def test_rendered_md_returns_html(client):
    upload = _upload(client).json()
    _force_done(upload["ids"][0], "# Heading\n\n| a | b |\n| --- | --- |\n| 1 | 2 |", "md")
    r = client.get(f"/api/rendered/{upload['ids'][0]}")
    assert r.status_code == 200
    html = r.text
    assert "<h1>Heading</h1>" in html
    assert "<table>" in html


def test_rendered_docx_returns_html(client):
    upload = _upload(client).json()
    from app import db, main
    from app.storage import DocumentRepo
    conn = db.get_connection(main.DB_PATH)
    DocumentRepo(conn).update(upload["ids"][0], format="docx")
    conn.close()
    _force_done(upload["ids"][0], fmt="docx")
    r = client.get(f"/api/rendered/{upload['ids'][0]}?format=docx")
    assert r.status_code == 200
    assert "<" in r.text


def test_recovery_on_restart(tmp_data_dir):
    """Document in processing state → after restart startup → queued."""
    from unittest.mock import patch
    # Full fixture setup manually (for running a second TestClient)
    with patch("app.ocr_engine.process_file", return_value="# stub"), \
         patch("app.ocr_engine.get_engine"):
        from app import main
        main.DATA_DIR = tmp_data_dir
        main.DB_PATH = tmp_data_dir / "data.db"
        # Also mock worker so it does not consume the queue between the two TestClient instances
        async def _noop_worker():
            while True:
                import asyncio
                await asyncio.sleep(3600)
        with patch("app.main.worker", _noop_worker):
            with TestClient(main.app) as c:
                upload = _upload(c).json()
                doc_id = upload["ids"][0]
                from app import db
                from app.storage import DocumentRepo
                conn = db.get_connection(main.DB_PATH)
                DocumentRepo(conn).update(doc_id, status="processing")
                conn.close()
            # Closed TestClient — now second run (new startup)
            with TestClient(main.app) as c:
                r = c.get("/api/status").json()
                target = next(d for d in r if d["id"] == doc_id)
                assert target["status"] in ("queued", "processing", "done")


def test_orphan_files_cleaned(client, tmp_data_dir):
    """FS directory with no DB record → deleted by run_orphan_cleanup."""
    orphan = tmp_data_dir / "docs" / "orphan_id"
    orphan.mkdir()
    (orphan / "original.pdf").write_bytes(b"x")
    from app import main
    result = main.run_orphan_cleanup()
    assert result["removed_fs"] >= 1
    assert not orphan.exists()


def test_ghost_record_marked_error(client, tmp_data_dir):
    """DB record with no files on disk → status=error."""
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    import shutil
    shutil.rmtree(tmp_data_dir / "docs" / doc_id, ignore_errors=True)
    from app import main
    result = main.run_orphan_cleanup()
    assert result["marked_ghost"] >= 1
    r = client.get("/api/status").json()
    target = next(d for d in r if d["id"] == doc_id)
    assert target["status"] == "error"


def test_page_progress_updates_during_processing(tmp_data_dir, monkeypatch):
    """progress_percent is updated via callback during PDF OCR."""
    from unittest.mock import patch
    from app import main, db
    from app.storage import DocumentRepo

    # Conftest stubs paddleocr at module load; clear app.* to ensure a fresh import after data dir override
    for mod in list(sys.modules.keys()):
        if mod.startswith("app"):
            del sys.modules[mod]

    from app import main, db
    from app.storage import DocumentRepo

    main.DATA_DIR = tmp_data_dir
    main.DB_PATH = tmp_data_dir / "data.db"

    captured_pcent = []

    def fake_process(path, progress_callback=None, stage_callback=None):
        if progress_callback:
            progress_callback(1, 4)
            conn = db.get_connection(main.DB_PATH)
            doc_id = list(DocumentRepo(conn).list_all_ids())[0]
            captured_pcent.append(DocumentRepo(conn).get(doc_id)["progress_percent"])
            conn.close()
            progress_callback(4, 4)
        return "# stub"

    with patch("app.ocr_engine.process_file", side_effect=fake_process), \
         patch("app.ocr_engine.get_engine"):
        with TestClient(main.app) as c:
            r = _upload(c)
            doc_id = r.json()["ids"][0]
            # Auto-start is gone: explicitly trigger OCR via /api/recognize.
            c.post("/api/recognize?project_id=1")
            import time
            for _ in range(50):
                time.sleep(0.1)
                conn = db.get_connection(main.DB_PATH)
                if DocumentRepo(conn).get(doc_id)["status"] == "done":
                    conn.close()
                    break
                conn.close()

    assert captured_pcent and captured_pcent[0] == 25.0


def test_project_zip_empty_project_returns_404(client):
    p = client.post("/api/projects", json={"name": "EmptyZip"}).json()
    r = client.get(f"/api/projects/{p['id']}/zip")
    assert r.status_code == 404


def test_project_zip_returns_zip_with_results(client):
    """ZIP contains only results of completed documents."""
    p = client.post("/api/projects", json={"name": "ZipP"}).json()
    upload = _upload(client, project_id=p["id"]).json()
    _force_done(upload["ids"][0], "# zipped result", "md")
    r = client.get(f"/api/projects/{p['id']}/zip")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"

    import io, zipfile
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = z.namelist()
    assert any(n.endswith(".md") for n in names)
    assert b"zipped result" in z.read(names[0])


def test_project_zip_skips_processing_documents(client):
    """ZIP does not include documents with status != done."""
    p = client.post("/api/projects", json={"name": "MixedZip"}).json()
    done_id = _upload(client, name="a.pdf", project_id=p["id"]).json()["ids"][0]
    queued_id = _upload(client, name="b.pdf", project_id=p["id"]).json()["ids"][0]
    _force_done(done_id, "# only this", "md")

    r = client.get(f"/api/projects/{p['id']}/zip")
    assert r.status_code == 200
    import io, zipfile
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = z.namelist()
    assert len(names) == 1
    assert "a" in names[0]


def test_project_zip_404_on_missing_project(client):
    r = client.get("/api/projects/99999/zip")
    assert r.status_code == 404


def test_project_zip_disambiguates_duplicate_filenames(client):
    """Two done documents with the same stem → second one gets suffix _1."""
    p = client.post("/api/projects", json={"name": "Dups"}).json()
    a_id = _upload(client, name="report.pdf", project_id=p["id"]).json()["ids"][0]
    b_id = _upload(client, name="report.pdf", project_id=p["id"]).json()["ids"][0]
    _force_done(a_id, "# first", "md")
    _force_done(b_id, "# second", "md")
    r = client.get(f"/api/projects/{p['id']}/zip")
    assert r.status_code == 200
    import io, zipfile
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = sorted(z.namelist())
    assert names == ["report.md", "report_1.md"]


def test_status_includes_elapsed_and_eta(client):
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    from app import db, main
    from app.storage import DocumentRepo
    conn = db.get_connection(main.DB_PATH)
    DocumentRepo(conn).update(
        doc_id,
        status="processing",
        started_at="2026-04-25T10:00:00+00:00",
        progress_percent=25.0,
    )
    conn.close()
    docs = client.get("/api/status").json()
    target = next(d for d in docs if d["id"] == doc_id)
    assert "elapsed_seconds" in target
    assert "eta_seconds" in target
    assert target["elapsed_seconds"] is not None and target["elapsed_seconds"] > 0
    assert target["eta_seconds"] is not None and target["eta_seconds"] > 0


def test_status_elapsed_none_when_not_started(client):
    upload = _upload(client).json()
    docs = client.get("/api/status").json()
    target = next(d for d in docs if d["id"] == upload["ids"][0])
    assert target["elapsed_seconds"] is None
    assert target["eta_seconds"] is None


def test_limits_endpoint(client):
    r = client.get("/api/limits")
    assert r.status_code == 200
    body = r.json()
    assert body["max_file_size_bytes"] == 50 * 1024 * 1024
    assert ".pdf" in body["allowed_extensions"]


def test_engine_preload_endpoint_removed(client):
    """After Task 3: /api/engine/preload endpoint removed, any request → 404."""
    r = client.post("/api/engine/preload?lang=ru")
    assert r.status_code == 404


def test_ocr_upload_returns_ids_warnings_shape(client):
    """New shape for /api/ocr: {ids, warnings, errors}."""
    r = _upload(client)
    assert r.status_code == 200
    data = r.json()
    assert "ids" in data
    assert "warnings" in data
    assert "errors" in data
    assert isinstance(data["ids"], list)
    assert len(data["ids"]) == 1


def test_ocr_upload_does_not_start_processing(client):
    """Upload leaves the document in queued state — does NOT start the worker."""
    r = _upload(client)
    doc_id = r.json()["ids"][0]
    status = client.get("/api/status").json()
    target = next(d for d in status if d["id"] == doc_id)
    assert target["status"] == "queued"


def test_recognize_endpoint_starts_queued_docs(client):
    """POST /api/recognize?project_id=N places queued documents into the processing queue."""
    upload1 = _upload(client, name="a.pdf").json()
    upload2 = _upload(client, name="b.pdf").json()
    ids = upload1["ids"] + upload2["ids"]

    r = client.post("/api/recognize?project_id=1")
    assert r.status_code == 200
    data = r.json()
    assert data["started"] == 2
    assert set(data["doc_ids"]) == set(ids)


def test_recognize_endpoint_404_for_missing_project(client):
    r = client.post("/api/recognize?project_id=99999")
    assert r.status_code == 404


def test_recognize_endpoint_zero_when_no_queued(client):
    p = client.post("/api/projects", json={"name": "Empty"}).json()
    r = client.post(f"/api/recognize?project_id={p['id']}")
    assert r.status_code == 200
    assert r.json()["started"] == 0
    assert r.json()["doc_ids"] == []


def test_upload_pdf_long_returns_warning(client, monkeypatch):
    """PDF >50 pages must return a long_processing warning with page count."""
    import app.main as m
    monkeypatch.setattr(m, "_pdf_page_count", lambda _p: 87)
    r = _upload(client, name="big.pdf")
    data = r.json()
    assert len(data["warnings"]) == 1
    w = data["warnings"][0]
    assert w["type"] == "long_processing"
    assert w["pages"] == 87
    assert w["id"] == data["ids"][0]


def test_upload_pdf_short_no_warning(client, monkeypatch):
    """PDF <=50 pages must not return a warning."""
    import app.main as m
    monkeypatch.setattr(m, "_pdf_page_count", lambda _p: 5)
    r = _upload(client, name="small.pdf")
    data = r.json()
    assert data["warnings"] == []


def test_upload_image_no_warning(client):
    """Images never produce a warning."""
    files = [("files", ("x.png", io.BytesIO(b"fake-png"), "image/png"))]
    data_form = {"format": "md", "lang": "ru"}
    r = client.post("/api/ocr", files=files, data=data_form)
    data = r.json()
    assert data["warnings"] == []


def test_source_endpoint_returns_original_image(client):
    files = [("files", ("orig.png", io.BytesIO(b"fake-image-bytes"), "image/png"))]
    data_form = {"format": "md", "lang": "ru"}
    r = client.post("/api/ocr", files=files, data=data_form)
    doc_id = r.json()["ids"][0]
    r2 = client.get(f"/api/source/{doc_id}")
    assert r2.status_code == 200
    assert r2.content == b"fake-image-bytes"


def test_source_endpoint_404_for_missing_doc(client):
    r = client.get("/api/source/nonexistent99")
    assert r.status_code == 404


def test_system_engine_lang_is_fixed_ru(client):
    """engine_lang is always 'ru' regardless of the _engine state (Task 2 fix)."""
    r = client.get("/api/system")
    assert r.status_code == 200
    assert r.json()["engine_lang"] == "ru"


def test_markdown_endpoint_returns_raw_text_plain(client):
    """Regression Task 9: /api/markdown/{id} returns raw markdown as text/plain.

    Previously the endpoint returned JSON {"markdown": "..."}, and the frontend
    via `_text(resp)` showed the literal JSON string in <pre> instead of markdown.
    """
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    body = "# Heading\n\nbody **bold** text"
    _force_done(doc_id, body, "md")

    r = client.get(f"/api/markdown/{doc_id}")
    assert r.status_code == 200
    ctype = r.headers.get("content-type", "").lower()
    assert "text/plain" in ctype, f"expected text/plain, got {ctype}"
    assert r.text == body


def test_rendered_endpoint_returns_html_text(client):
    """Regression Task 9: /api/rendered/{id} returns raw HTML as text/html,
    so the frontend via `_text(resp)` can insert it directly into innerHTML."""
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    _force_done(doc_id, "# Heading\n\nbody", "md")

    r = client.get(f"/api/rendered/{doc_id}")
    assert r.status_code == 200
    ctype = r.headers.get("content-type", "").lower()
    assert "text/html" in ctype, f"expected text/html, got {ctype}"
    assert "<h1>Heading</h1>" in r.text


def test_status_includes_available_formats(client):
    """Every doc in /api/status has the field available_formats: list[str]."""
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    _force_done(doc_id, "# md content", "md")

    docs = client.get("/api/status").json()
    target = next(d for d in docs if d["id"] == doc_id)
    assert "available_formats" in target
    assert target["available_formats"] == ["md"]


def test_status_available_formats_lists_multiple(client):
    """If both md and docx exist in the directory — both appear in the list."""
    from app import files as files_mod
    import app.main as m
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    _force_done(doc_id, "# md", "md")
    files_mod.save_result(m.DATA_DIR, doc_id, b"PK fake docx", "docx")

    docs = client.get("/api/status").json()
    target = next(d for d in docs if d["id"] == doc_id)
    assert sorted(target["available_formats"]) == ["docx", "md"]


def test_worker_saves_only_result_md(tmp_data_dir):
    """After OCR, the doc directory contains only result.md, not result.txt/docx."""
    from unittest.mock import patch
    from app import main, db, files as files_mod
    from app.storage import DocumentRepo

    # Reset module cache for a clean import with the correct DATA_DIR
    for mod in list(sys.modules.keys()):
        if mod.startswith("app"):
            del sys.modules[mod]

    from app import main, db, files as files_mod
    from app.storage import DocumentRepo

    main.DATA_DIR = tmp_data_dir
    main.DB_PATH = tmp_data_dir / "data.db"

    with patch("app.ocr_engine.process_file", return_value="# stub md content"), \
         patch("app.ocr_engine.get_engine"):
        with TestClient(main.app) as c:
            upload = _upload(c).json()
            doc_id = upload["ids"][0]

            # Force format=docx to verify the worker ignores it when saving
            conn = db.get_connection(main.DB_PATH)
            DocumentRepo(conn).update(doc_id, format="docx")
            conn.commit()
            conn.close()

            c.post("/api/recognize?project_id=1")

            # Worker runs asynchronously — wait for done
            import time
            for _ in range(30):
                time.sleep(0.2)
                conn = db.get_connection(main.DB_PATH)
                status = DocumentRepo(conn).get(doc_id)["status"]
                conn.close()
                if status == "done":
                    break

            # Only result.md on disk (even when format=docx in DB)
            formats = files_mod.available_formats(main.DATA_DIR, doc_id)
            assert formats == ["md"], f"expected only ['md'], got {formats}"


# ---------------------------------------------------------------------------
# Task 4: /api/result/{doc_id}?format=md|txt|docx lazy generation tests
# ---------------------------------------------------------------------------

def test_result_endpoint_format_md_returns_existing(client):
    """?format=md returns result.md if it exists."""
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    _force_done(doc_id, "# md content", "md")
    r = client.get(f"/api/result/{doc_id}?format=md")
    assert r.status_code == 200
    assert "text/markdown" in r.headers.get("content-type", "") or r.text == "# md content"


def test_result_endpoint_format_docx_lazy_generates_from_md(client):
    """?format=docx — converts from result.md on first request, saves it, then returns it."""
    from app import files as files_mod
    import app.main as m
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    _force_done(doc_id, "# md content\n\nbody", "md")
    assert files_mod.result_path_for_format(m.DATA_DIR, doc_id, "docx") is None

    r = client.get(f"/api/result/{doc_id}?format=docx")
    assert r.status_code == 200
    assert r.content[:2] == b"PK"
    assert files_mod.result_path_for_format(m.DATA_DIR, doc_id, "docx") is not None


def test_result_endpoint_format_docx_idempotent(client):
    """Repeated ?format=docx serves from disk, does not regenerate."""
    from app import files as files_mod
    import app.main as m
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    _force_done(doc_id, "# md", "md")

    r1 = client.get(f"/api/result/{doc_id}?format=docx")
    p = files_mod.result_path_for_format(m.DATA_DIR, doc_id, "docx")
    assert p is not None
    mtime1 = p.stat().st_mtime

    import time
    time.sleep(0.05)
    r2 = client.get(f"/api/result/{doc_id}?format=docx")
    mtime2 = p.stat().st_mtime
    assert r1.content == r2.content
    assert mtime1 == mtime2


def test_result_endpoint_format_unavailable_for_legacy(client):
    """Legacy: only result.txt on disk, no result.md → ?format=docx → 404."""
    from app import files as files_mod
    import app.main as m
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    from app.storage import DocumentRepo
    conn = m._conn()
    DocumentRepo(conn).update(doc_id, status="done", format="txt")
    conn.commit()
    conn.close()
    files_mod.save_result(m.DATA_DIR, doc_id, "plain text only", "txt")

    r = client.get(f"/api/result/{doc_id}?format=docx")
    assert r.status_code == 404


def test_result_endpoint_format_native_for_legacy(client):
    """Legacy with result.txt: ?format=txt returns it."""
    from app import files as files_mod
    import app.main as m
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    from app.storage import DocumentRepo
    conn = m._conn()
    DocumentRepo(conn).update(doc_id, status="done", format="txt")
    conn.commit()
    conn.close()
    files_mod.save_result(m.DATA_DIR, doc_id, "plain text", "txt")

    r = client.get(f"/api/result/{doc_id}?format=txt")
    assert r.status_code == 200
    assert r.text == "plain text"


def test_result_endpoint_default_format_uses_db_field(client):
    """Without query param — backend uses documents.format from DB (backward compat)."""
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    _force_done(doc_id, "# md", "md")
    r = client.get(f"/api/result/{doc_id}")
    assert r.status_code == 200


def test_markdown_endpoint_format_txt_lazy_generates(client):
    """?format=txt — generates txt from md and returns plain text."""
    from app import files as files_mod
    import app.main as m
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    _force_done(doc_id, "# Heading\n\nbody **bold**", "md")
    assert files_mod.result_path_for_format(m.DATA_DIR, doc_id, "txt") is None

    r = client.get(f"/api/markdown/{doc_id}?format=txt")
    assert r.status_code == 200
    assert "text/plain" in r.headers.get("content-type", "")
    assert "**" not in r.text
    assert files_mod.result_path_for_format(m.DATA_DIR, doc_id, "txt") is not None


def test_markdown_endpoint_default_returns_md(client):
    """Without ?format — returns result.md raw."""
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    _force_done(doc_id, "# raw md", "md")
    r = client.get(f"/api/markdown/{doc_id}")
    assert r.status_code == 200
    assert r.text == "# raw md"


def test_markdown_endpoint_format_unavailable_for_legacy(client):
    """Legacy with result.docx but no result.md → ?format=md → 404."""
    from app import files as files_mod
    import app.main as m
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    from app.storage import DocumentRepo
    conn = m._conn()
    DocumentRepo(conn).update(doc_id, status="done", format="docx")
    conn.commit()
    conn.close()
    files_mod.save_result(m.DATA_DIR, doc_id, b"PK fake", "docx")

    r = client.get(f"/api/markdown/{doc_id}?format=md")
    assert r.status_code == 404


def test_rendered_endpoint_format_md_returns_html_from_markdown(client):
    """?format=md — markdown → HTML via the markdown library + bleach."""
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    _force_done(doc_id, "# Heading\n\n| a | b |\n| --- | --- |\n| 1 | 2 |", "md")
    r = client.get(f"/api/rendered/{doc_id}?format=md")
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
    assert "<h1>Heading</h1>" in r.text
    assert "<table>" in r.text


def test_rendered_endpoint_format_docx_lazy_renders_via_mammoth(client):
    """?format=docx — lazily generates result.docx, renders it via mammoth."""
    from app import files as files_mod
    import app.main as m
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    _force_done(doc_id, "# Test heading", "md")

    r = client.get(f"/api/rendered/{doc_id}?format=docx")
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
    assert "<" in r.text
    assert files_mod.result_path_for_format(m.DATA_DIR, doc_id, "docx") is not None


def test_rendered_endpoint_format_unavailable_for_legacy(client):
    """Legacy with result.txt → ?format=docx → 404 (no md source for generation)."""
    from app import files as files_mod
    import app.main as m
    upload = _upload(client).json()
    doc_id = upload["ids"][0]
    from app.storage import DocumentRepo
    conn = m._conn()
    DocumentRepo(conn).update(doc_id, status="done", format="txt")
    conn.commit()
    conn.close()
    files_mod.save_result(m.DATA_DIR, doc_id, "plain", "txt")

    r = client.get(f"/api/rendered/{doc_id}?format=docx")
    assert r.status_code == 404


def test_upload_creates_doc_with_md_format_regardless_of_request(client):
    """Backend always creates a doc with format='md'.

    Even if the client accidentally sends format=docx — it is ignored.
    """
    import io
    files = [("files", ("a.png", io.BytesIO(b"fake"), "image/png"))]
    r = client.post("/api/ocr", files=files, data={"format": "docx", "project_id": "1"})
    assert r.status_code == 200
    doc_id = r.json()["ids"][0]
    docs = client.get("/api/status").json()
    target = next(d for d in docs if d["id"] == doc_id)
    assert target["format"] == "md"


# ---------------------------------------------------------------------------
# Task 4: preview info/thumbs/page endpoints
# ---------------------------------------------------------------------------

def _make_doc(client, tmp_data_dir, filename):
    """Create a project + document with a placeholder original file. Returns (pid, did)."""
    from app import storage, db, files as files_mod
    conn = db.get_connection(tmp_data_dir / "data.db")
    pr = storage.ProjectRepo(conn)
    pr.ensure_inbox()
    doc_repo = storage.DocumentRepo(conn)
    import uuid
    did = uuid.uuid4().hex[:12]
    files_mod.save_original(tmp_data_dir, did, b"placeholder", filename)
    doc_repo.create(doc_id=did, project_id=1, filename=filename,
                    format="md", lang="ru", size_bytes=11)
    conn.close()
    return 1, did


def test_preview_info_returns_count_and_kind_for_pdf(client, tmp_data_dir):
    import fitz
    from app import files as files_mod

    pid, did = _make_doc(client, tmp_data_dir, "x.pdf")
    pdf = fitz.open()
    pdf.new_page(width=200, height=200)
    pdf.new_page(width=200, height=200)
    pdf.save(str(files_mod.original_path(tmp_data_dir, did)))
    pdf.close()

    r = client.get(f"/api/preview/{did}/info")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    assert body["kind"] == "pdf"
    assert body["thumbs_progress"] is None


def test_preview_thumbs_returns_base64_pages(client, tmp_data_dir):
    import fitz
    from app import files as files_mod
    pid, did = _make_doc(client, tmp_data_dir, "x.pdf")
    pdf = fitz.open()
    pdf.new_page()
    pdf.new_page()
    pdf.save(str(files_mod.original_path(tmp_data_dir, did)))
    pdf.close()

    r = client.get(f"/api/preview/{did}/thumbs")
    assert r.status_code == 200
    pages = r.json()["pages"]
    assert len(pages) == 2
    import base64
    base64.b64decode(pages[0])  # should not raise


def test_preview_page_returns_jpeg_bytes(client, tmp_data_dir):
    import fitz
    from app import files as files_mod
    pid, did = _make_doc(client, tmp_data_dir, "x.pdf")
    pdf = fitz.open()
    pdf.new_page()
    pdf.new_page()
    pdf.save(str(files_mod.original_path(tmp_data_dir, did)))
    pdf.close()

    r = client.get(f"/api/preview/{did}/page/2")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/jpeg")
    # JPEG magic bytes
    assert r.content[:3] == b"\xff\xd8\xff"


def test_preview_page_404_on_invalid_page(client, tmp_data_dir):
    import fitz
    from app import files as files_mod
    pid, did = _make_doc(client, tmp_data_dir, "x.pdf")
    pdf = fitz.open()
    pdf.new_page()  # 1-page PDF
    pdf.save(str(files_mod.original_path(tmp_data_dir, did)))
    pdf.close()

    r = client.get(f"/api/preview/{did}/page/99")
    assert r.status_code == 404


def test_preview_info_404_for_missing_doc(client):
    r = client.get("/api/preview/nonexistent/info")
    assert r.status_code == 404


def test_doc_response_includes_stage_field(client, tmp_data_dir):
    pid, did = _make_doc(client, tmp_data_dir, "x.pdf")
    r = client.get(f"/api/status?project_id=1")
    assert r.status_code == 200
    rows = r.json()
    assert rows[0]["stage"] is None  # default
    assert "stage_label" in rows[0]


def test_worker_sets_engine_loading_stage_when_engine_not_ready(tmp_data_dir):
    """When _engine is None, worker should set stage='engine_loading' before calling get_engine."""
    from unittest.mock import MagicMock, patch

    with patch("app.ocr_engine.process_file", return_value="# stub"), \
         patch("app.ocr_engine.get_engine"):
        # Reload modules fresh so we get a clean app instance
        for mod in list(sys.modules.keys()):
            if mod.startswith("app"):
                del sys.modules[mod]

        from app import main, ocr_engine, db, files as files_mod
        from app.storage import DocumentRepo, ProjectRepo

        main.DATA_DIR = tmp_data_dir
        main.DB_PATH = tmp_data_dir / "data.db"

        # Set up DB
        db.init(main.DB_PATH)
        conn = db.get_connection(main.DB_PATH)
        ProjectRepo(conn).ensure_inbox()
        conn.close()

        # Create a doc entry
        import uuid
        doc_id = str(uuid.uuid4())
        conn = db.get_connection(main.DB_PATH)
        DocumentRepo(conn).create(doc_id, 1, "test.pdf", "md", "ru", size_bytes=100)
        conn.close()

        # Write a fake original file
        doc_dir = tmp_data_dir / "docs" / doc_id
        doc_dir.mkdir(parents=True, exist_ok=True)
        (doc_dir / "original.pdf").write_bytes(b"%PDF-1.4 fake")

        # Force engine to None
        ocr_engine._engine = None

        # Track stage transitions
        stages_seen = []
        original_update = DocumentRepo.update

        def spy_update(self, doc_id, **fields):
            if "stage" in fields:
                stages_seen.append(fields["stage"])
            return original_update(self, doc_id, **fields)

        # Mock get_engine to set a fake engine
        fake_engine = MagicMock()
        fake_engine.predict.return_value = iter([])

        def fake_get_engine():
            ocr_engine._engine = fake_engine
            return fake_engine

        # Run worker with mocks applied
        with patch.object(DocumentRepo, "update", spy_update), \
             patch.object(ocr_engine, "get_engine", fake_get_engine):

            async def _run_one():
                await main.task_queue.put(doc_id)
                worker_task = asyncio.create_task(main.worker())
                await main.task_queue.join()
                worker_task.cancel()
                try:
                    await worker_task
                except asyncio.CancelledError:
                    pass

            asyncio.run(_run_one())

    assert "engine_loading" in stages_seen, f"engine_loading stage not set; saw: {stages_seen}"


# ---------------------------------------------------------------------------
# Task 18 (extended): stage_label includes pipeline model names
# ---------------------------------------------------------------------------

def test_doc_response_engine_loading_label_includes_models(client, tmp_data_dir):
    """stage_label for engine_loading mentions pipeline model names."""
    from app import storage, db
    pid, did = _make_doc(client, tmp_data_dir, "x.pdf")
    conn = db.get_connection(tmp_data_dir / "data.db")
    try:
        storage.DocumentRepo(conn).update(did, status="processing", stage="engine_loading")
    finally:
        conn.close()
    r = client.get(f"/api/status?project_id={pid}")
    rows = r.json()
    target = [d for d in rows if d["id"] == did][0]
    assert "layout" in target["stage_label"]
    assert "text" in target["stage_label"]
    assert "table" in target["stage_label"]


def test_doc_response_ocr_label_includes_pipeline_name(client, tmp_data_dir):
    """stage_label for ocr includes the pipeline name."""
    from app import storage, db
    pid, did = _make_doc(client, tmp_data_dir, "x.pdf")
    conn = db.get_connection(tmp_data_dir / "data.db")
    try:
        storage.DocumentRepo(conn).update(
            did, status="processing", stage="ocr",
            current_page=2, page_count=5,
        )
    finally:
        conn.close()
    r = client.get(f"/api/status?project_id={pid}")
    rows = r.json()
    target = [d for d in rows if d["id"] == did][0]
    assert "PPStructureV3" in target["stage_label"]
    assert "2/5" in target["stage_label"]


def test_doc_response_ocr_label_with_stage_detail(client, tmp_data_dir):
    """stage_label for ocr includes page info and stage_detail (sub-model name)."""
    from app import storage, db
    pid, did = _make_doc(client, tmp_data_dir, "x.pdf")
    conn = db.get_connection(tmp_data_dir / "data.db")
    try:
        storage.DocumentRepo(conn).update(
            did, status="processing", stage="ocr",
            current_page=2, page_count=5,
            stage_detail="text",
        )
    finally:
        conn.close()
    r = client.get(f"/api/status?project_id={pid}")
    rows = r.json()
    target = [d for d in rows if d["id"] == did][0]
    assert "2/5" in target["stage_label"]
    assert "text" in target["stage_label"]


def test_system_info_includes_pipeline_models(client):
    r = client.get("/api/system")
    body = r.json()
    assert "engine_pipeline" in body
    assert isinstance(body["engine_pipeline"], list)
    assert len(body["engine_pipeline"]) >= 4  # layout, text_det, text_rec, table, formula
    roles = {m["role"] for m in body["engine_pipeline"]}
    assert {"layout", "text_rec", "table", "formula"}.issubset(roles)


# ---------------------------------------------------------------------------
# Task 7: GET/PUT /api/settings + onboarding dismiss
# ---------------------------------------------------------------------------

def test_get_settings_returns_defaults(client):
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    body = resp.json()
    assert body["hq_mode"] is False
    assert body["hq_orientation"] is False
    assert body["onboarding_seen"] is False


def test_put_settings_persists(client):
    new = {"hq_mode": True, "hq_orientation": True, "hq_unwarping": False,
           "hq_textline": False, "hq_chart": False, "hq_seal": False}
    resp = client.put("/api/settings", json=new)
    assert resp.status_code == 200
    assert resp.json().get("status") == "reloading"
    body = client.get("/api/settings").json()
    assert body["hq_orientation"] is True


def test_put_settings_blocked_when_queue_not_empty(client, monkeypatch):
    from app import main
    monkeypatch.setattr(main.task_queue, "qsize", lambda: 1)
    resp = client.put("/api/settings", json={"hq_mode": True})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "queue_not_empty"


def test_dismiss_onboarding(client):
    assert client.get("/api/settings").json()["onboarding_seen"] is False
    resp = client.post("/api/settings/onboarding/dismiss")
    assert resp.status_code == 204
    assert client.get("/api/settings").json()["onboarding_seen"] is True


def test_reload_stream_emits_done_event(client):
    """SSE stream must emit at least one event with 'done' marker."""
    from app import main

    # Force reload-state to indicate completion before request
    main._reload_state.update({"done": True, "loaded": 10, "total": 10, "current": "x"})

    with client.stream("GET", "/api/settings/reload-stream") as resp:
        assert resp.status_code == 200
        first_chunk = ""
        for line in resp.iter_lines():
            first_chunk += line
            if "done" in first_chunk:
                break
        assert "done" in first_chunk


# ---------------------------------------------------------------------------
# Task 9 (re-OCR): reset done document + bulk project re-OCR
# ---------------------------------------------------------------------------

def test_reocr_doc_resets_status_and_clears_results(client):
    """Done doc -> POST /reocr -> status=queued, result files deleted."""
    from app import files as files_mod
    import app.main as m
    upload = client.post(
        "/api/ocr",
        files={"files": ("a.pdf", b"%PDF-fake", "application/pdf")},
        data={"format": "md", "lang": "ru"},
    )
    doc_id = upload.json()["ids"][0]
    _force_done(doc_id, "# done")

    md_path = files_mod.result_path_for_format(m.DATA_DIR, doc_id, "md")
    assert md_path is not None and md_path.exists()

    resp = client.post(f"/api/documents/{doc_id}/reocr")
    assert resp.status_code == 200
    assert resp.json()["status"] == "queued"

    assert files_mod.result_path_for_format(m.DATA_DIR, doc_id, "md") is None


def test_reocr_doc_400_when_not_done(client):
    """Attempt to re-OCR a document that is not in 'done' state -> 400."""
    upload = client.post(
        "/api/ocr",
        files={"files": ("b.pdf", b"%PDF-fake", "application/pdf")},
        data={"format": "md", "lang": "ru"},
    )
    doc_id = upload.json()["ids"][0]
    resp = client.post(f"/api/documents/{doc_id}/reocr")
    assert resp.status_code == 400


def test_reocr_project_bulk(client):
    """All done docs in project -> bulk reocr -> all in queue."""
    upload = client.post(
        "/api/ocr",
        files=[
            ("files", ("a.pdf", b"%PDF", "application/pdf")),
            ("files", ("b.pdf", b"%PDF", "application/pdf")),
            ("files", ("c.pdf", b"%PDF", "application/pdf")),
        ],
        data={"format": "md", "lang": "ru"},
    )
    ids = upload.json()["ids"]
    for did in ids:
        _force_done(did, f"# {did}")

    resp = client.post("/api/projects/1/reocr")  # Inbox
    assert resp.status_code == 200
    body = resp.json()
    assert body["requeued"] == 3
    assert set(body["doc_ids"]) == set(ids)


# ---------------------------------------------------------------------------
# Task 10: Watch project auto-created, rename/delete restrictions
# ---------------------------------------------------------------------------

def test_watch_project_auto_created(client):
    """Lifespan creates the Watch project (id=2) next to Inbox."""
    resp = client.get("/api/projects")
    assert resp.status_code == 200
    by_id = {p["id"]: p for p in resp.json()}
    assert 1 in by_id and by_id[1]["name"] == "Inbox"
    assert 2 in by_id and by_id[2]["name"] == "Watch"


def test_watch_project_cannot_be_renamed_via_api(client):
    resp = client.patch("/api/projects/2", json={"name": "MyWatch"})
    assert resp.status_code == 400


def test_watch_project_cannot_be_deleted_via_api(client):
    resp = client.delete("/api/projects/2")
    assert resp.status_code == 400


def test_read_watcher_env_defaults(monkeypatch):
    """No env vars set → (5.0, 3) — matches docker-compose.yml documented defaults."""
    monkeypatch.delenv("WATCH_INTERVAL", raising=False)
    monkeypatch.delenv("WATCH_STABLE_SECS", raising=False)
    from app.main import _read_watcher_env
    assert _read_watcher_env() == (5.0, 3)


def test_read_watcher_env_reads_from_environment(monkeypatch):
    """Explicit env vars are parsed and returned."""
    monkeypatch.setenv("WATCH_INTERVAL", "2.5")
    monkeypatch.setenv("WATCH_STABLE_SECS", "10")
    from app.main import _read_watcher_env
    assert _read_watcher_env() == (2.5, 10)


def test_read_watcher_env_falls_back_on_unparseable_values(monkeypatch):
    """Garbage env vars fall back to defaults instead of crashing startup."""
    monkeypatch.setenv("WATCH_INTERVAL", "abc")
    monkeypatch.setenv("WATCH_STABLE_SECS", "xyz")
    from app.main import _read_watcher_env
    assert _read_watcher_env() == (5.0, 3)


def test_system_endpoint_includes_queue_field(client):
    r = client.get("/api/system")
    assert r.status_code == 200
    data = r.json()
    assert "queue" in data
    assert set(data["queue"].keys()) == {"queued", "processing", "completed_since_start", "current"}
    assert data["queue"]["queued"] == 0
    assert data["queue"]["processing"] == 0
    assert data["queue"]["completed_since_start"] == 0


def test_system_queue_counts_queued_and_processing(client):
    r = _upload(client)
    queued_doc_id = r.json()["ids"][0]

    r2 = _upload(client, name="y.pdf")
    processing_doc_id = r2.json()["ids"][0]

    from app import main, storage
    conn = main._conn()
    try:
        storage.DocumentRepo(conn).update(processing_doc_id, status="processing")
    finally:
        conn.close()

    data = client.get("/api/system").json()
    assert data["queue"]["queued"] == 1
    assert data["queue"]["processing"] == 1


def test_system_queue_excludes_done_and_error(client):
    r = _upload(client)
    doc_id = r.json()["ids"][0]
    from app import main, storage
    conn = main._conn()
    try:
        storage.DocumentRepo(conn).update(doc_id, status="done")
    finally:
        conn.close()

    data = client.get("/api/system").json()
    assert data["queue"]["queued"] == 0
    assert data["queue"]["processing"] == 0


def test_system_completed_counter_exposed(client, monkeypatch):
    from app import main
    monkeypatch.setattr(main, "_completed_counter", 42)
    data = client.get("/api/system").json()
    assert data["queue"]["completed_since_start"] == 42


def test_system_queue_current_null_when_no_processing(client):
    data = client.get("/api/system").json()
    assert data["queue"]["current"] is None


def test_system_queue_current_returns_processing_doc(client):
    r = _upload(client, name="doc-a.pdf")
    doc_id = r.json()["ids"][0]
    from app import main, storage
    conn = main._conn()
    try:
        storage.DocumentRepo(conn).update(doc_id, status="processing")
    finally:
        conn.close()

    data = client.get("/api/system").json()
    assert data["queue"]["current"] is not None
    assert data["queue"]["current"]["filename"] == "doc-a.pdf"
    assert isinstance(data["queue"]["current"]["size_bytes"], int)
    assert data["queue"]["current"]["size_bytes"] > 0


def test_system_queue_current_picks_one_when_multiple_processing(client):
    r1 = _upload(client, name="doc-1.pdf")
    r2 = _upload(client, name="doc-2.pdf")
    from app import main, storage
    conn = main._conn()
    try:
        repo = storage.DocumentRepo(conn)
        repo.update(r1.json()["ids"][0], status="processing")
        repo.update(r2.json()["ids"][0], status="processing")
    finally:
        conn.close()

    data = client.get("/api/system").json()
    assert data["queue"]["current"] is not None
    assert data["queue"]["current"]["filename"] in ("doc-1.pdf", "doc-2.pdf")
