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
