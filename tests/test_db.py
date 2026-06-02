"""
Unit tests for app/db.py.
Maintenance notes: add corresponding tests when adding new migrations.
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
    version = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    assert version >= 3
    conn.close()


def test_init_idempotent(tmp_data_dir):
    db_path = tmp_data_dir / "data.db"
    db.init(db_path)
    db.init(db_path)  # second call must not raise
    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT version FROM schema_version ORDER BY version").fetchall()
    assert rows == [(1,), (2,), (3,), (4,), (5,), (6,)]
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


def test_check_constraint_rejects_bad_created_at(tmp_data_dir):
    """v2 migration: created_at in projects must match the ISO-8601 prefix 20XX-."""
    import pytest
    db_path = tmp_data_dir / "data.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO projects (name, created_at) VALUES (?, ?)",
            ("P", "not-a-date"),
        )
        conn.commit()
    conn.close()


def test_check_constraint_accepts_iso_created_at(tmp_data_dir):
    """ISO-8601 dates with timezone must pass the constraint."""
    db_path = tmp_data_dir / "data.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    conn.execute(
        "INSERT INTO projects (name, created_at) VALUES (?, ?)",
        ("P_ok", "2026-04-26T12:00:00+00:00"),
    )
    conn.commit()
    rows = list(conn.execute("SELECT name FROM projects WHERE name='P_ok'"))
    assert len(rows) == 1
    conn.close()


def test_check_constraint_rejects_bad_doc_created_at(tmp_data_dir):
    """v2 migration also applies the constraint to documents.created_at."""
    import pytest
    db_path = tmp_data_dir / "data.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    conn.execute(
        "INSERT INTO projects (name, created_at) VALUES (?, ?)",
        ("P", "2026-04-26T00:00:00+00:00"),
    )
    pid = conn.execute("SELECT id FROM projects WHERE name='P'").fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO documents (id, project_id, filename, format, lang, status, created_at) "
            "VALUES (?, ?, ?, 'md', 'ru', 'queued', ?)",
            ("d" * 12, pid, "f.pdf", "garbage"),
        )
    conn.close()


def test_migration_v3_adds_stage_columns(tmp_path):
    from app import db
    db_path = tmp_path / "test.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    try:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(documents)").fetchall()}
        assert "stage" in cols
        assert "stage_updated_at" in cols
        # Schema version should be at least 3
        v = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
        assert v >= 3
    finally:
        conn.close()


def test_migration_v3_idempotent(tmp_path):
    from app import db
    db_path = tmp_path / "test.db"
    db.init(db_path)
    db.init(db_path)  # second call must not raise
    conn = db.get_connection(db_path)
    try:
        v = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
        assert v >= 3
    finally:
        conn.close()


def test_migration_v4_adds_stage_detail_column(tmp_path):
    from app import db
    db_path = tmp_path / "test.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    try:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(documents)").fetchall()}
        assert "stage_detail" in cols
        v = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
        assert v >= 4
    finally:
        conn.close()


def test_settings_table_created_on_v5(tmp_path):
    from app import db
    db.init(tmp_path / "data.db")
    conn = db.get_connection(tmp_path / "data.db")
    try:
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'"
        ).fetchone()
        assert cur is not None, "settings table must exist after migration"
        cols = [r[1] for r in conn.execute("PRAGMA table_info(settings)").fetchall()]
        assert cols == ["key", "value"], f"unexpected columns: {cols}"
        ver = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
        assert ver >= 5  # v5 creates settings; current version may be higher
    finally:
        conn.close()


def test_settings_migration_marks_existing_users_onboarded(tmp_path):
    """v4 → v5 migration on existing DB sets onboarding_seen='1'."""
    from app import db
    conn_setup = db.get_connection(tmp_path / "data.db")
    conn_setup.execute("CREATE TABLE schema_version (version INTEGER PRIMARY KEY)")
    conn_setup.execute("INSERT INTO schema_version VALUES (1)")
    conn_setup.execute("INSERT INTO schema_version VALUES (2)")
    conn_setup.execute("INSERT INTO schema_version VALUES (3)")
    conn_setup.execute("INSERT INTO schema_version VALUES (4)")
    # Create a minimal documents table so v6 ALTER TABLE ADD COLUMN can succeed.
    # Simulates a real pre-v5 installation that always had documents (created at v1).
    conn_setup.execute("""
        CREATE TABLE documents (
            id TEXT PRIMARY KEY,
            project_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            format TEXT NOT NULL,
            lang TEXT NOT NULL,
            status TEXT NOT NULL,
            error TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            page_count INTEGER,
            current_page INTEGER,
            progress_percent REAL,
            size_bytes INTEGER,
            stage TEXT,
            stage_updated_at TEXT,
            stage_detail TEXT
        )
    """)
    conn_setup.commit()
    conn_setup.close()

    db.init(tmp_path / "data.db")

    conn = db.get_connection(tmp_path / "data.db")
    try:
        row = conn.execute(
            "SELECT value FROM settings WHERE key='onboarding_seen'"
        ).fetchone()
        assert row is not None
        assert row[0] == "1", "existing users must skip onboarding"
    finally:
        conn.close()


def test_settings_migration_fresh_install_not_onboarded(tmp_path):
    """Fresh DB (no prior schema_version) sets onboarding_seen='0'."""
    from app import db
    db.init(tmp_path / "data.db")
    conn = db.get_connection(tmp_path / "data.db")
    try:
        row = conn.execute(
            "SELECT value FROM settings WHERE key='onboarding_seen'"
        ).fetchone()
        assert row is not None
        assert row[0] == "0", "fresh install must show onboarding"
    finally:
        conn.close()


def test_v6_adds_source_columns(tmp_path):
    """v6 migration adds documents.source and documents.source_relpath as nullable columns."""
    db_path = tmp_path / "data.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    try:
        cols = {row["name"]: row for row in conn.execute("PRAGMA table_info(documents)")}
        assert "source" in cols
        assert "source_relpath" in cols
        assert cols["source"]["notnull"] == 0
        assert cols["source_relpath"]["notnull"] == 0
        assert cols["source"]["dflt_value"] is None
        assert cols["source_relpath"]["dflt_value"] is None
        v = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
        assert v == 6
    finally:
        conn.close()


def test_v2_migration_preserves_v1_data(tmp_data_dir):
    """v1→v2 migration must preserve existing records."""
    db_path = tmp_data_dir / "data.db"
    # Simulate an "old" database: create only v1
    import sqlite3 as _sql
    raw = _sql.connect(str(db_path))
    raw.execute("PRAGMA journal_mode = WAL")
    raw.executescript("""
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
    """)
    db._migrate_to_v1(raw)
    raw.execute("INSERT INTO schema_version VALUES (1)")
    raw.execute(
        "INSERT INTO projects (name, created_at) VALUES (?, ?)",
        ("Legacy", "2026-04-25T10:00:00+00:00"),
    )
    pid = raw.execute("SELECT id FROM projects WHERE name='Legacy'").fetchone()[0]
    raw.execute(
        "INSERT INTO documents (id, project_id, filename, format, lang, status, created_at) "
        "VALUES (?, ?, ?, 'md', 'ru', 'done', ?)",
        ("legacy123abc", pid, "old.pdf", "2026-04-25T11:00:00+00:00"),
    )
    raw.commit()
    raw.close()

    # Now call init — must pick up from where it left off and migrate to the current version
    db.init(db_path)
    conn = db.get_connection(db_path)
    proj_count = conn.execute("SELECT COUNT(*) FROM projects WHERE name='Legacy'").fetchone()[0]
    doc_count = conn.execute("SELECT COUNT(*) FROM documents WHERE id='legacy123abc'").fetchone()[0]
    assert proj_count == 1
    assert doc_count == 1
    version = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    assert version >= 3
    conn.close()
