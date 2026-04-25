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
