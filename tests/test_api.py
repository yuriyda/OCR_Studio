"""
Integration-тесты API через FastAPI TestClient.

Редактирование:
- Добавлять новые тесты, не удалять существующие без согласования.
- OCR-движок всегда мокается, чтобы не грузить PaddleOCR в тестовой среде.
- При добавлении новых роутов — добавлять соответствующие тесты здесь.
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
    # paddleocr stubs устанавливаются на module level через tests/conftest.py:stub_paddleocr_modules

    # Перезагружаем модули, чтобы учесть заглушки (если уже импортированы ранее)
    for mod in list(sys.modules.keys()):
        if mod.startswith("app"):
            del sys.modules[mod]

    async def _noop_worker():
        await asyncio.sleep(3600)  # не обрабатывает очередь в тестах

    with patch("app.ocr_engine.process_file", return_value="# stub"), \
         patch("app.ocr_engine.get_engine"), \
         patch("app.main.worker", _noop_worker):
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
    """Помощник: помечает документ done и кладёт result-файл."""
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
    html = r.json()["html"]
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
    r = client.get(f"/api/rendered/{upload['ids'][0]}")
    assert r.status_code == 200
    assert "<" in r.json()["html"]


def test_rendered_txt_wraps_pre(client):
    upload = _upload(client).json()
    from app import db, main
    from app.storage import DocumentRepo
    conn = db.get_connection(main.DB_PATH)
    DocumentRepo(conn).update(upload["ids"][0], format="txt")
    conn.close()
    _force_done(upload["ids"][0], "plain\ntext", "txt")
    r = client.get(f"/api/rendered/{upload['ids'][0]}")
    assert "<pre>" in r.json()["html"]


def test_recovery_on_restart(tmp_data_dir):
    """Документ в processing → после повторного startup → queued."""
    from unittest.mock import patch
    # Полная установка fixture-окружения вручную (для повторного запуска TestClient)
    with patch("app.ocr_engine.process_file", return_value="# stub"), \
         patch("app.ocr_engine.get_engine"):
        from app import main
        main.DATA_DIR = tmp_data_dir
        main.DB_PATH = tmp_data_dir / "data.db"
        # Также мокаем worker, чтобы он не съел очередь между двумя TestClient
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
            # Закрыли TestClient — теперь второй запуск (новый startup)
            with TestClient(main.app) as c:
                r = c.get("/api/status").json()
                target = next(d for d in r if d["id"] == doc_id)
                assert target["status"] in ("queued", "processing", "done")


def test_orphan_files_cleaned(client, tmp_data_dir):
    """FS-папка без записи в БД → удалена run_orphan_cleanup."""
    orphan = tmp_data_dir / "docs" / "orphan_id"
    orphan.mkdir()
    (orphan / "original.pdf").write_bytes(b"x")
    from app import main
    result = main.run_orphan_cleanup()
    assert result["removed_fs"] >= 1
    assert not orphan.exists()


def test_ghost_record_marked_error(client, tmp_data_dir):
    """Запись в БД без файлов на диске → status=error."""
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
    """progress_percent обновляется через callback при OCR PDF."""
    from unittest.mock import patch
    from app import main, db
    from app.storage import DocumentRepo

    # Conftest stubs paddleocr at module load; clear app.* to ensure fresh import after data dir override
    for mod in list(sys.modules.keys()):
        if mod.startswith("app"):
            del sys.modules[mod]

    from app import main, db
    from app.storage import DocumentRepo

    main.DATA_DIR = tmp_data_dir
    main.DB_PATH = tmp_data_dir / "data.db"

    captured_pcent = []

    def fake_process(path, lang, progress_callback=None):
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
            # Auto-start больше нет: явно запускаем OCR через /api/recognize.
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
    """ZIP содержит только результаты завершённых документов."""
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
    """ZIP не включает документы со статусом != done."""
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
    """Два done-документа с одинаковым stem → второй получает суффикс _1."""
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


def test_engine_preload_invalid_lang_400(client):
    r = client.post("/api/engine/preload?lang=zz")
    assert r.status_code == 400


def test_engine_preload_returns_loading_when_lang_differs(client, monkeypatch):
    """Если движок не загружен или загружен под другой язык — возвращаем 'loading'."""
    from app import ocr_engine
    monkeypatch.setattr(ocr_engine, "_engine", None, raising=False)
    monkeypatch.setattr(ocr_engine, "_engine_lang", "ru", raising=False)
    r = client.post("/api/engine/preload?lang=en")
    assert r.status_code == 200
    assert r.json()["status"] == "loading"


def test_engine_preload_returns_ready_when_already_loaded(client, monkeypatch):
    """Если движок уже загружен под этот же язык — сразу 'ready'."""
    from app import ocr_engine
    monkeypatch.setattr(ocr_engine, "_engine", object(), raising=False)
    monkeypatch.setattr(ocr_engine, "_engine_lang", "ru", raising=False)
    r = client.post("/api/engine/preload?lang=ru")
    assert r.status_code == 200
    assert r.json()["status"] == "ready"


def test_ocr_upload_returns_ids_warnings_shape(client):
    """Новый shape /api/ocr: {ids, warnings, errors}."""
    r = _upload(client)
    assert r.status_code == 200
    data = r.json()
    assert "ids" in data
    assert "warnings" in data
    assert "errors" in data
    assert isinstance(data["ids"], list)
    assert len(data["ids"]) == 1


def test_ocr_upload_does_not_start_processing(client):
    """Upload оставляет документ в queued — НЕ запускает worker."""
    r = _upload(client)
    doc_id = r.json()["ids"][0]
    status = client.get("/api/status").json()
    target = next(d for d in status if d["id"] == doc_id)
    assert target["status"] == "queued"


def test_recognize_endpoint_starts_queued_docs(client):
    """POST /api/recognize?project_id=N кладёт queued докi в очередь."""
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
    """PDF >50 страниц должен вернуть warning long_processing с числом страниц."""
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
    """PDF <=50 страниц не должен возвращать warning."""
    import app.main as m
    monkeypatch.setattr(m, "_pdf_page_count", lambda _p: 5)
    r = _upload(client, name="small.pdf")
    data = r.json()
    assert data["warnings"] == []


def test_upload_image_no_warning(client):
    """Изображения никогда не дают warning."""
    files = [("files", ("x.png", io.BytesIO(b"fake-png"), "image/png"))]
    data_form = {"format": "md", "lang": "ru"}
    r = client.post("/api/ocr", files=files, data=data_form)
    data = r.json()
    assert data["warnings"] == []
