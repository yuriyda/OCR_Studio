"""Unit-тесты для app/storage.py — ProjectRepo и DocumentRepo."""
import pytest

from app import db
from app.storage import ProjectRepo, ProjectError


@pytest.fixture
def repo(tmp_data_dir):
    db_path = tmp_data_dir / "data.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    return ProjectRepo(conn)


def test_create_inbox_on_first_use(repo):
    repo.ensure_inbox()
    inbox = repo.get(1)
    assert inbox["id"] == 1
    assert inbox["name"] == "Inbox"


def test_ensure_inbox_idempotent(repo):
    repo.ensure_inbox()
    repo.ensure_inbox()
    projects = repo.list()
    assert len(projects) == 1


def test_create_project(repo):
    repo.ensure_inbox()
    p = repo.create("Project A")
    assert p["id"] > 1
    assert p["name"] == "Project A"


def test_create_unique_name(repo):
    repo.ensure_inbox()
    repo.create("Test")
    with pytest.raises(ProjectError, match="exists"):
        repo.create("Test")


def test_create_empty_name_rejected(repo):
    with pytest.raises(ProjectError, match="empty"):
        repo.create("   ")


def test_create_too_long_rejected(repo):
    with pytest.raises(ProjectError, match="too long"):
        repo.create("x" * 101)


def test_rename_project(repo):
    repo.ensure_inbox()
    p = repo.create("Old")
    repo.rename(p["id"], "New")
    assert repo.get(p["id"])["name"] == "New"


def test_rename_inbox_forbidden(repo):
    repo.ensure_inbox()
    with pytest.raises(ProjectError, match="Inbox"):
        repo.rename(1, "Renamed")


def test_delete_project(repo):
    repo.ensure_inbox()
    p = repo.create("Tmp")
    repo.delete(p["id"])
    assert repo.get(p["id"]) is None


def test_delete_inbox_forbidden(repo):
    repo.ensure_inbox()
    with pytest.raises(ProjectError, match="Inbox"):
        repo.delete(1)


def test_list_returns_all(repo):
    repo.ensure_inbox()
    repo.create("A")
    repo.create("B")
    names = [p["name"] for p in repo.list()]
    assert names == ["Inbox", "A", "B"]


# ---------------------------------------------------------------------------
# DocumentRepo tests
# ---------------------------------------------------------------------------

from app.storage import DocumentRepo


@pytest.fixture
def doc_repo(tmp_data_dir):
    db_path = tmp_data_dir / "data.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    pr = ProjectRepo(conn)
    pr.ensure_inbox()
    return DocumentRepo(conn)


def test_document_create(doc_repo):
    d = doc_repo.create(
        doc_id="abc123def456",
        project_id=1,
        filename="x.pdf",
        format="md",
        lang="ru",
        size_bytes=1024,
    )
    assert d["id"] == "abc123def456"
    assert d["status"] == "queued"
    assert d["created_at"] is not None


def test_document_get(doc_repo):
    doc_repo.create("aa", 1, "x.pdf", "md", "ru", 100)
    d = doc_repo.get("aa")
    assert d["filename"] == "x.pdf"


def test_document_get_missing_returns_none(doc_repo):
    assert doc_repo.get("missing") is None


def test_document_update_status(doc_repo):
    doc_repo.create("aa", 1, "x.pdf", "md", "ru", 100)
    doc_repo.update("aa", status="processing", started_at="2026-04-25T10:00:00+00:00")
    d = doc_repo.get("aa")
    assert d["status"] == "processing"
    assert d["started_at"] == "2026-04-25T10:00:00+00:00"


def test_document_list_filter_by_project(doc_repo):
    doc_repo.create("a1", 1, "x.pdf", "md", "ru", 100)
    pr = ProjectRepo(doc_repo.conn)
    p = pr.create("P2")
    doc_repo.create("b2", p["id"], "y.pdf", "md", "ru", 200)
    docs = doc_repo.list(project_id=1)
    assert {d["id"] for d in docs} == {"a1"}


def test_document_list_sort_by_size(doc_repo):
    doc_repo.create("a1", 1, "small.pdf", "md", "ru", 100)
    doc_repo.create("a2", 1, "big.pdf", "md", "ru", 999)
    docs = doc_repo.list(project_id=1, sort="size", order="desc")
    assert [d["id"] for d in docs] == ["a2", "a1"]


def test_document_list_sort_by_name_asc(doc_repo):
    doc_repo.create("a1", 1, "zzz.pdf", "md", "ru", 100)
    doc_repo.create("a2", 1, "aaa.pdf", "md", "ru", 100)
    docs = doc_repo.list(project_id=1, sort="name", order="asc")
    assert [d["filename"] for d in docs] == ["aaa.pdf", "zzz.pdf"]


def test_document_move_between_projects(doc_repo):
    doc_repo.create("a1", 1, "x.pdf", "md", "ru", 100)
    pr = ProjectRepo(doc_repo.conn)
    p = pr.create("P2")
    doc_repo.move("a1", p["id"])
    assert doc_repo.get("a1")["project_id"] == p["id"]


def test_document_delete(doc_repo):
    doc_repo.create("a1", 1, "x.pdf", "md", "ru", 100)
    doc_repo.delete("a1")
    assert doc_repo.get("a1") is None


def test_project_cascade_delete_documents(doc_repo):
    pr = ProjectRepo(doc_repo.conn)
    p = pr.create("ToDelete")
    doc_repo.create("d1", p["id"], "x.pdf", "md", "ru", 100)
    pr.delete(p["id"])
    assert doc_repo.get("d1") is None


def test_recover_processing_to_queued(doc_repo):
    doc_repo.create("a1", 1, "x.pdf", "md", "ru", 100)
    doc_repo.update("a1", status="processing")
    doc_repo.recover_processing()
    assert doc_repo.get("a1")["status"] == "queued"


def test_total_bytes_per_project(doc_repo):
    doc_repo.create("a1", 1, "x.pdf", "md", "ru", 100)
    doc_repo.create("a2", 1, "y.pdf", "md", "ru", 200)
    assert doc_repo.total_bytes(1) == 300


def test_total_bytes_empty_project_returns_zero(doc_repo):
    pr = ProjectRepo(doc_repo.conn)
    p = pr.create("Empty")
    assert doc_repo.total_bytes(p["id"]) == 0


def test_iso_dates_roundtrip(doc_repo):
    from datetime import datetime, timezone
    doc_repo.create("a1", 1, "x.pdf", "md", "ru", 100)
    d = doc_repo.get("a1")
    parsed = datetime.fromisoformat(d["created_at"])
    assert parsed.tzinfo is not None
