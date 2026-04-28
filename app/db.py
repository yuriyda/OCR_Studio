"""
SQLite connection, schema initialisation, and migrations for the OCR service.

Maintenance notes:
- Every schema change must go through a new _migrate_to_vN function.
- Do not modify existing migrations after release — only add new ones.
- Schema version is tracked in the schema_version table.
- Date CHECK constraints use GLOB '20[0-9][0-9]-*' —
  accepts ISO-8601 prefixes (with/without timezone), rejects arbitrary text.
"""
import sqlite3
from pathlib import Path

CURRENT_VERSION = 5


def get_connection(db_path: Path) -> sqlite3.Connection:
    """Open a connection with foreign keys enabled and WAL mode."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def init(db_path: Path) -> None:
    """Create the database (if absent) and apply migrations up to CURRENT_VERSION."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)"
        )
        cur = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
        current = cur[0] or 0
        if current < 1:
            _migrate_to_v1(conn)
            conn.execute("INSERT INTO schema_version VALUES (1)")
        if current < 2:
            # _migrate_to_v2 includes INSERT INTO schema_version VALUES (2) inside its own transaction.
            _migrate_to_v2(conn)
        if current < 3:
            _migrate_to_v3(conn)
            conn.execute("INSERT INTO schema_version VALUES (3)")
        if current < 4:
            _migrate_to_v4(conn)
            conn.execute("INSERT INTO schema_version VALUES (4)")
        if current < 5:
            _migrate_to_v5(conn, was_fresh=(current == 0))
            conn.execute("INSERT INTO schema_version VALUES (5)")
        conn.commit()
    finally:
        conn.close()


def _migrate_to_v1(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE projects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE documents (
      id              TEXT PRIMARY KEY,
      project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      filename        TEXT NOT NULL,
      format          TEXT NOT NULL CHECK (format IN ('md','txt','docx')),
      lang            TEXT NOT NULL CHECK (lang IN ('ru','en')),
      status          TEXT NOT NULL CHECK (status IN ('queued','processing','done','error')),
      error           TEXT,
      created_at      TEXT NOT NULL,
      started_at      TEXT,
      finished_at     TEXT,
      page_count      INTEGER,
      current_page    INTEGER,
      progress_percent REAL,
      size_bytes      INTEGER
    );

    CREATE INDEX idx_documents_project ON documents(project_id);
    CREATE INDEX idx_documents_created ON documents(created_at DESC);
    """)


_V2_STATEMENTS = [
    # Clean up zombie temp tables left by a previously interrupted migration (if any).
    "DROP TABLE IF EXISTS projects_v2",
    "DROP TABLE IF EXISTS documents_v2",
    """CREATE TABLE projects_v2 (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL CHECK (created_at GLOB '20[0-9][0-9]-*')
    )""",
    "INSERT INTO projects_v2 (id, name, created_at) SELECT id, name, created_at FROM projects",
    "DROP TABLE projects",
    "ALTER TABLE projects_v2 RENAME TO projects",
    """CREATE TABLE documents_v2 (
      id              TEXT PRIMARY KEY,
      project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      filename        TEXT NOT NULL,
      format          TEXT NOT NULL CHECK (format IN ('md','txt','docx')),
      lang            TEXT NOT NULL CHECK (lang IN ('ru','en')),
      status          TEXT NOT NULL CHECK (status IN ('queued','processing','done','error')),
      error           TEXT,
      created_at      TEXT NOT NULL CHECK (created_at GLOB '20[0-9][0-9]-*'),
      started_at      TEXT,
      finished_at     TEXT,
      page_count      INTEGER,
      current_page    INTEGER,
      progress_percent REAL,
      size_bytes      INTEGER
    )""",
    "INSERT INTO documents_v2 SELECT * FROM documents",
    "DROP TABLE documents",
    "ALTER TABLE documents_v2 RENAME TO documents",
    "CREATE INDEX idx_documents_project ON documents(project_id)",
    "CREATE INDEX idx_documents_created ON documents(created_at DESC)",
]


def _migrate_to_v2(conn: sqlite3.Connection) -> None:
    """Add CHECK (created_at GLOB '20[0-9][0-9]-*') to projects and documents.

    SQLite does not support ALTER TABLE ADD CONSTRAINT — tables are recreated
    via temp-name + INSERT SELECT + DROP + RENAME.

    Atomicity: all DDL statements + version row are wrapped in one transaction
    (BEGIN/COMMIT/ROLLBACK). If the process crashes mid-way, ROLLBACK won't run,
    but on the next init() call `current` will still be 1 and the migration will
    retry starting with DROP TABLE IF EXISTS projects_v2 (zombie cleanup).

    FK constraints are disabled during migration (otherwise DROP TABLE projects
    triggers a cascade-delete on documents). Restored to original state in finally.

    GLOB '20[0-9][0-9]-*' — valid year range: 2000-2099. After 2099 add a v3
    migration to extend the pattern.
    """
    fk_was_on = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    # Python sqlite3 defaults to implicit transaction management;
    # switch to autocommit so we can control BEGIN/COMMIT manually.
    old_iso = conn.isolation_level
    conn.isolation_level = None
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.execute("BEGIN")
        try:
            for stmt in _V2_STATEMENTS:
                conn.execute(stmt)
            conn.execute("INSERT INTO schema_version VALUES (2)")
            orphans = conn.execute("PRAGMA foreign_key_check").fetchall()
            if orphans:
                raise RuntimeError(f"v2 migration left orphan FK rows: {orphans}")
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    finally:
        if fk_was_on:
            conn.execute("PRAGMA foreign_keys = ON")
        conn.isolation_level = old_iso


def _migrate_to_v3(conn: sqlite3.Connection) -> None:
    """Add stage / stage_updated_at columns for progress reporting.

    Stage values in `documents.stage`:
    - NULL    — neutral state (queued/done/error do not need a stage)
    - 'engine_loading' — worker is waiting for `ocr_engine.get_engine()` (~30 s on first OCR)
    - 'ocr'   — engine.predict() is running; `current_page`/`page_count`/`progress_percent`
                are updated concurrently

    `stage_updated_at` — ISO-8601 timestamp of the last stage update.
    Intended for future heartbeat checks to detect a stuck worker.

    ALTER TABLE ADD COLUMN is safe for nullable columns — no table recreation needed.
    """
    conn.execute("ALTER TABLE documents ADD COLUMN stage TEXT")
    conn.execute("ALTER TABLE documents ADD COLUMN stage_updated_at TEXT")


def _migrate_to_v4(conn: sqlite3.Connection) -> None:
    """Add stage_detail column for sub-model name during OCR.

    Examples: 'layout', 'text', 'table', 'formula', 'chart'. Worker writes via
    stage_callback installed in app/ocr_engine.py. UI shows together with stage:
    "Page N/M: <stage_detail>".
    """
    conn.execute("ALTER TABLE documents ADD COLUMN stage_detail TEXT")


def _migrate_to_v5(conn: sqlite3.Connection, was_fresh: bool) -> None:
    """Create settings table for HQ-mode toggle and onboarding flag.

    Existing installations (was_fresh=False) get onboarding_seen='1' so they do
    not see the welcome modal. Fresh installations get '0'. All hq_* keys default
    to '0' (basic mode); the onboarding modal recommends turning them on based
    on detected GPU VRAM.
    """
    conn.execute("""
        CREATE TABLE settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    onboarding_value = "1" if not was_fresh else "0"
    defaults = [
        ("hq_mode", "0"),
        ("hq_orientation", "0"),
        ("hq_unwarping", "0"),
        ("hq_textline", "0"),
        ("hq_chart", "0"),
        ("hq_seal", "0"),
        ("onboarding_seen", onboarding_value),
    ]
    conn.executemany("INSERT INTO settings (key, value) VALUES (?, ?)", defaults)
