"""
SQLite-подключение, инициализация схемы и миграции для OCR-сервиса.

Редактирование:
- Любое изменение схемы — через новую функцию миграции _migrate_to_vN.
- Не менять существующие миграции после релиза — только добавлять новые.
- Версия схемы хранится в таблице schema_version.
- Для CHECK-constraints на даты используется GLOB '20[0-9][0-9]-*' —
  принимает ISO-8601 префикс (с/без таймзоны), отклоняет произвольный текст.
"""
import sqlite3
from pathlib import Path

CURRENT_VERSION = 2


def get_connection(db_path: Path) -> sqlite3.Connection:
    """Открыть соединение с включёнными foreign keys и WAL."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def init(db_path: Path) -> None:
    """Создать БД (если нет) и применить миграции до CURRENT_VERSION."""
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
            # _migrate_to_v2 включает INSERT INTO schema_version VALUES (2) в свою транзакцию.
            _migrate_to_v2(conn)
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
    # Очистка zombie temp-таблиц от прерванной миграции (если есть).
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
    """Добавить CHECK (created_at GLOB '20[0-9][0-9]-*') на projects и documents.

    SQLite не поддерживает ALTER TABLE ADD CONSTRAINT — пересоздаём таблицы
    через temp-name + INSERT SELECT + DROP + RENAME.

    Атомарность: оборачиваем все DDL-statements + version row в одну транзакцию
    (BEGIN/COMMIT/ROLLBACK). Если процесс падает в середине — `ROLLBACK` не успеет,
    но при следующем `init()` `current` всё ещё будет 1, миграция повторится с
    `DROP TABLE IF EXISTS projects_v2` в начале (cleanup zombies).

    FK на время миграции выключаем (иначе DROP TABLE projects → cascade-delete
    для documents). Возвращаем FK в исходное состояние в finally.

    GLOB '20[0-9][0-9]-*' — допустимый диапазон годов: 2000-2099. После 2099
    добавить v3 миграцию с расширением паттерна.
    """
    fk_was_on = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    # Python sqlite3 в дефолте имеет implicit transaction management;
    # переходим в autocommit, чтобы вручную управлять BEGIN/COMMIT.
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
