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

WATCH_PROJECT_ID = 2
WATCH_PROJECT_NAME = "Watch"

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

    def ensure_watch_project(self) -> None:
        """Create the dedicated 'Watch' project if missing.

        Mirrors `ensure_inbox()`. The id is fixed (WATCH_PROJECT_ID = 2) so
        the watcher loop and the worker post-hook can reference it as a constant.
        Renaming and deletion are blocked by guards in `rename()` and `delete()`.
        """
        row = self.conn.execute(
            "SELECT id FROM projects WHERE id = ?", (WATCH_PROJECT_ID,)
        ).fetchone()
        if row is None:
            self.conn.execute(
                "INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)",
                (WATCH_PROJECT_ID, WATCH_PROJECT_NAME, _now_iso()),
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
        if project_id == WATCH_PROJECT_ID:
            raise ProjectError("Watch project cannot be renamed")
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
        if project_id == WATCH_PROJECT_ID:
            raise ProjectError("Watch project cannot be deleted")
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
        source: Optional[str] = None,
        source_relpath: Optional[str] = None,
    ) -> dict:
        self.conn.execute(
            """INSERT INTO documents
               (id, project_id, filename, format, lang, status, created_at,
                size_bytes, source, source_relpath)
               VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)""",
            (doc_id, project_id, filename, format, lang, _now_iso(),
             size_bytes, source, source_relpath),
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

    def queue_counts(self) -> dict[str, int]:
        """Return active queue snapshot: counts of documents in queued / processing.

        Used by /api/system to drive the global status bar progress indicator.
        Excludes 'done' and 'error' — those documents are no longer in the queue.
        """
        rows = self.conn.execute(
            "SELECT status, COUNT(*) AS n FROM documents "
            "WHERE status IN ('queued', 'processing') GROUP BY status"
        ).fetchall()
        counts = {"queued": 0, "processing": 0}
        for r in rows:
            counts[r["status"]] = int(r["n"])
        return counts

    def currently_processing(self) -> dict | None:
        """Return the oldest 'processing' document as a dict, or None.

        Used by /api/system to show the currently processing file in the
        global status bar. Only one document can be in 'processing' at a
        time under single-worker design, but we still take a deterministic
        ordering by created_at to avoid jitter if multiple ever appear.
        """
        row = self.conn.execute(
            "SELECT filename, size_bytes FROM documents "
            "WHERE status = 'processing' ORDER BY created_at ASC LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        return {"filename": row["filename"], "size_bytes": int(row["size_bytes"])}

    def queued_in_project(self, project_id: int) -> list[dict]:
        """Return queued documents in the given project, ordered by creation time."""
        cur = self.conn.execute(
            "SELECT * FROM documents WHERE project_id = ? AND status = 'queued' "
            "ORDER BY created_at ASC",
            (project_id,),
        )
        return [dict(r) for r in cur.fetchall()]

    def exists_active_by_relpath(self, project_id: int, source_relpath: str) -> bool:
        """Return True iff an active (queued/processing/done) watcher document
        already exists for this (project, source_relpath) pair.

        Used by the watcher to avoid re-ingesting a file that is already in
        the pipeline or has already been processed. 'error' documents are NOT
        considered active — the user may have moved the file out of errors/
        and re-dropped it for a retry.
        """
        row = self.conn.execute(
            "SELECT 1 FROM documents "
            "WHERE project_id = ? AND source_relpath = ? "
            "AND status IN ('queued', 'processing', 'done') "
            "LIMIT 1",
            (project_id, source_relpath),
        ).fetchone()
        return row is not None
