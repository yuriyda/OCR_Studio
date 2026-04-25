"""
Unit-тесты для app/db.py.
Редактирование: при добавлении миграций добавлять соответствующие тесты.
"""
import sqlite3
from pathlib import Path

from app import db


def test_init_creates_schema(tmp_data_dir):
    db.init(tmp_data_dir / "data.db")
    conn = sqlite3.connect(tmp_data_dir / "data.db")
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    assert {"schema_version", "projects", "documents"} <= tables
    version = conn.execute("SELECT version FROM schema_version").fetchone()[0]
    assert version == 1
    conn.close()


def test_init_idempotent(tmp_data_dir):
    db_path = tmp_data_dir / "data.db"
    db.init(db_path)
    db.init(db_path)  # повторный вызов не должен падать
    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT version FROM schema_version").fetchall()
    assert rows == [(1,)]
    conn.close()


def test_init_wal_mode(tmp_data_dir):
    db_path = tmp_data_dir / "data.db"
    db.init(db_path)
    conn = sqlite3.connect(db_path)
    mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    assert mode.lower() == "wal"
    conn.close()


def test_get_connection_foreign_keys_on(tmp_data_dir):
    db_path = tmp_data_dir / "data.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    val = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    assert val == 1
    conn.close()


def test_cascade_delete_documents_with_project(tmp_data_dir):
    db_path = tmp_data_dir / "data.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    conn.execute(
        "INSERT INTO projects (name, created_at) VALUES (?, ?)",
        ("P", "2026-04-25T00:00:00+00:00"),
    )
    pid = conn.execute("SELECT id FROM projects WHERE name='P'").fetchone()[0]
    conn.execute(
        "INSERT INTO documents (id, project_id, filename, format, lang, status, created_at) "
        "VALUES (?, ?, ?, 'md', 'ru', 'queued', ?)",
        ("a" * 12, pid, "f.pdf", "2026-04-25T00:00:00+00:00"),
    )
    conn.commit()
    conn.execute("DELETE FROM projects WHERE id = ?", (pid,))
    conn.commit()
    assert conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 0
    conn.close()


def test_check_constraint_invalid_status_rejected(tmp_data_dir):
    db_path = tmp_data_dir / "data.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    conn.execute(
        "INSERT INTO projects (name, created_at) VALUES (?, ?)",
        ("P", "2026-04-25T00:00:00+00:00"),
    )
    pid = conn.execute("SELECT id FROM projects WHERE name='P'").fetchone()[0]
    import pytest
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO documents (id, project_id, filename, format, lang, status, created_at) "
            "VALUES (?, ?, ?, 'md', 'ru', 'INVALID', ?)",
            ("b" * 12, pid, "f.pdf", "2026-04-25T00:00:00+00:00"),
        )
    conn.close()


def test_check_constraint_invalid_format_rejected(tmp_data_dir):
    db_path = tmp_data_dir / "data.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    conn.execute(
        "INSERT INTO projects (name, created_at) VALUES (?, ?)",
        ("P", "2026-04-25T00:00:00+00:00"),
    )
    pid = conn.execute("SELECT id FROM projects WHERE name='P'").fetchone()[0]
    import pytest
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO documents (id, project_id, filename, format, lang, status, created_at) "
            "VALUES (?, ?, ?, 'pdf', 'ru', 'queued', ?)",
            ("c" * 12, pid, "f.pdf", "2026-04-25T00:00:00+00:00"),
        )
    conn.close()
