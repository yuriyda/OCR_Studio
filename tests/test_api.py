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
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


def _stub_paddleocr_modules():
    """Подставляет заглушки для paddleocr и paddlepaddle, которых нет в тестовой среде."""
    for mod_name in ("paddleocr", "paddle", "paddlepaddle"):
        if mod_name not in sys.modules:
            sys.modules[mod_name] = types.ModuleType(mod_name)
    paddle_mod = sys.modules["paddleocr"]
    paddle_mod.PPStructureV3 = MagicMock()


@pytest.fixture
def client(tmp_data_dir, monkeypatch):
    # Заглушаем paddleocr до импорта ocr_engine, чтобы избежать ModuleNotFoundError
    _stub_paddleocr_modules()

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
    assert len(body) == 1
    assert body[0]["project_id"] == 1


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
    assert r.json()[0]["project_id"] == p["id"]


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
    doc_id = upload[0]["id"]
    r = client.patch(f"/api/documents/{doc_id}", json={"project_id": p["id"]})
    assert r.status_code == 200
    assert r.json()["project_id"] == p["id"]


def test_move_to_missing_project_400(client):
    upload = _upload(client).json()
    r = client.patch(f"/api/documents/{upload[0]['id']}", json={"project_id": 99999})
    assert r.status_code == 400


def test_delete_document(client):
    upload = _upload(client).json()
    r = client.delete(f"/api/documents/{upload[0]['id']}")
    assert r.status_code == 204


def test_delete_processing_document_409(client):
    upload = _upload(client).json()
    from app import db, main
    from app.storage import DocumentRepo
    conn = db.get_connection(main.DB_PATH)
    DocumentRepo(conn).update(upload[0]["id"], status="processing")
    conn.close()
    r = client.delete(f"/api/documents/{upload[0]['id']}")
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
    _force_done(upload[0]["id"], "# Heading\n\n| a | b |\n| --- | --- |\n| 1 | 2 |", "md")
    r = client.get(f"/api/rendered/{upload[0]['id']}")
    assert r.status_code == 200
    html = r.json()["html"]
    assert "<h1>Heading</h1>" in html
    assert "<table>" in html


def test_rendered_docx_returns_html(client):
    upload = _upload(client).json()
    from app import db, main
    from app.storage import DocumentRepo
    conn = db.get_connection(main.DB_PATH)
    DocumentRepo(conn).update(upload[0]["id"], format="docx")
    conn.close()
    _force_done(upload[0]["id"], fmt="docx")
    r = client.get(f"/api/rendered/{upload[0]['id']}")
    assert r.status_code == 200
    assert "<" in r.json()["html"]


def test_rendered_txt_wraps_pre(client):
    upload = _upload(client).json()
    from app import db, main
    from app.storage import DocumentRepo
    conn = db.get_connection(main.DB_PATH)
    DocumentRepo(conn).update(upload[0]["id"], format="txt")
    conn.close()
    _force_done(upload[0]["id"], "plain\ntext", "txt")
    r = client.get(f"/api/rendered/{upload[0]['id']}")
    assert "<pre>" in r.json()["html"]
