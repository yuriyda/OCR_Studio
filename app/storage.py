"""
Repositories for project and document metadata.

Maintenance notes:
- All access to the projects/documents tables must go through these classes.
- Do not use sqlite connections directly from main.py or route handlers.
- Dates are stored and read as ISO-8601 UTC via datetime.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Optional

INBOX_ID = 1
INBOX_NAME = "Inbox"
MAX_NAME_LEN = 100


class ProjectError(Exception):
    """Error from project operations (validation, uniqueness, Inbox protection)."""


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


ALLOWED_SORT = {"created": "created_at", "name": "filename", "size": "size_bytes"}


class DocumentRepo:
    """CRUD repository for the documents table.

    Maintenance notes:
    - All sort columns are validated through ALLOWED_SORT (SQL injection guard).
    - update() accepts only keyword arguments; an empty call is a no-op.
    - Cascade deletion of documents on project deletion is handled by ON DELETE CASCADE in the schema.
    """

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def create(
        self,
        doc_id: str,
        project_id: int,
        filename: str,
        format: str,
        lang: str,
        size_bytes: int,
    ) -> dict:
        self.conn.execute(
            """INSERT INTO documents
               (id, project_id, filename, format, lang, status, created_at, size_bytes)
               VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)""",
            (doc_id, project_id, filename, format, lang, _now_iso(), size_bytes),
        )
        self.conn.commit()
        return self.get(doc_id)

    def get(self, doc_id: str) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT * FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
        return dict(row) if row else None

    def list(
        self,
        project_id: Optional[int] = None,
        sort: str = "created",
        order: str = "desc",
    ) -> list[dict]:
        sort_col = ALLOWED_SORT.get(sort, "created_at")
        order_sql = "ASC" if order.lower() == "asc" else "DESC"
        if project_id is not None:
            rows = self.conn.execute(
                f"SELECT * FROM documents WHERE project_id = ? "
                f"ORDER BY {sort_col} {order_sql}",
                (project_id,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                f"SELECT * FROM documents ORDER BY {sort_col} {order_sql}"
            ).fetchall()
        return [dict(r) for r in rows]

    def list_all_ids(self) -> list[str]:
        rows = self.conn.execute("SELECT id FROM documents").fetchall()
        return [r["id"] for r in rows]

    def update(self, doc_id: str, **fields) -> None:
        if not fields:
            return
        sets = ", ".join(f"{k} = ?" for k in fields)
        params = list(fields.values()) + [doc_id]
        self.conn.execute(f"UPDATE documents SET {sets} WHERE id = ?", params)
        self.conn.commit()

    def move(self, doc_id: str, new_project_id: int) -> None:
        self.conn.execute(
            "UPDATE documents SET project_id = ? WHERE id = ?",
            (new_project_id, doc_id),
        )
        self.conn.commit()

    def delete(self, doc_id: str) -> None:
        self.conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        self.conn.commit()

    def recover_processing(self) -> int:
        cur = self.conn.execute(
            "UPDATE documents SET status = 'queued' WHERE status = 'processing'"
        )
        self.conn.commit()
        return cur.rowcount

    def total_bytes(self, project_id: int) -> int:
        row = self.conn.execute(
            "SELECT COALESCE(SUM(size_bytes), 0) AS s FROM documents WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        return int(row["s"])

    def queued_ids_in_order(self) -> list[str]:
        rows = self.conn.execute(
            "SELECT id FROM documents WHERE status = 'queued' ORDER BY created_at ASC"
        ).fetchall()
        return [r["id"] for r in rows]

    def queued_in_project(self, project_id: int) -> list[dict]:
        """Return queued documents in the given project, ordered by creation time."""
        cur = self.conn.execute(
            "SELECT * FROM documents WHERE project_id = ? AND status = 'queued' "
            "ORDER BY created_at ASC",
            (project_id,),
        )
        return [dict(r) for r in cur.fetchall()]
