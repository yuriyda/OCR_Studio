"""
Репозитории для работы с метаданными проектов и документов.

Редактирование:
- Все обращения к таблицам projects/documents идут только через эти классы.
- Не использовать sqlite_connection напрямую из main.py или роутов.
- Даты сохраняются и читаются как ISO-8601 UTC через datetime.
"""
import sqlite3
from datetime import datetime, timezone
from typing import Optional

INBOX_ID = 1
INBOX_NAME = "Inbox"
MAX_NAME_LEN = 100


class ProjectError(Exception):
    """Ошибка операций над проектами (валидация, уникальность, защита Inbox)."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class ProjectRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def ensure_inbox(self) -> None:
        row = self.conn.execute(
            "SELECT id FROM projects WHERE id = ?", (INBOX_ID,)
        ).fetchone()
        if row is None:
            self.conn.execute(
                "INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)",
                (INBOX_ID, INBOX_NAME, _now_iso()),
            )
            self.conn.commit()

    def get(self, project_id: int) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT id, name, created_at FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        return dict(row) if row else None

    def list(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT id, name, created_at FROM projects ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]

    def create(self, name: str) -> dict:
        name = (name or "").strip()
        if not name:
            raise ProjectError("name is empty")
        if len(name) > MAX_NAME_LEN:
            raise ProjectError("name too long (max 100)")
        try:
            cur = self.conn.execute(
                "INSERT INTO projects (name, created_at) VALUES (?, ?)",
                (name, _now_iso()),
            )
            self.conn.commit()
        except sqlite3.IntegrityError:
            raise ProjectError(f"project '{name}' already exists")
        return self.get(cur.lastrowid)

    def rename(self, project_id: int, new_name: str) -> None:
        if project_id == INBOX_ID:
            raise ProjectError("Inbox cannot be renamed")
        new_name = (new_name or "").strip()
        if not new_name:
            raise ProjectError("name is empty")
        if len(new_name) > MAX_NAME_LEN:
            raise ProjectError("name too long (max 100)")
        try:
            self.conn.execute(
                "UPDATE projects SET name = ? WHERE id = ?", (new_name, project_id)
            )
            self.conn.commit()
        except sqlite3.IntegrityError:
            raise ProjectError(f"project '{new_name}' already exists")

    def delete(self, project_id: int) -> None:
        if project_id == INBOX_ID:
            raise ProjectError("Inbox cannot be deleted")
        self.conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        self.conn.commit()
