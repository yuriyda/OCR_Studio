"""
Persistent storage for HQ-mode flags and onboarding flag.

Maintenance notes:
- Single source of truth for `use_*` flags passed to PPStructureV3 in
  app/ocr_engine.py. Do not read settings directly from the DB elsewhere.
- Allowed keys are validated in set_hq_config — adding a new flag requires
  extending HQ_KEYS plus a DB migration to insert default value.
"""
from __future__ import annotations

import sqlite3

HQ_KEYS = (
    "hq_mode",
    "hq_orientation",
    "hq_unwarping",
    "hq_textline",
    "hq_chart",
    "hq_seal",
)


class SettingsRepo:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def get_hq_config(self) -> dict[str, bool]:
        rows = self._conn.execute(
            "SELECT key, value FROM settings WHERE key IN ({})".format(
                ",".join("?" * len(HQ_KEYS))
            ),
            HQ_KEYS,
        ).fetchall()
        result = {k: False for k in HQ_KEYS}
        for r in rows:
            result[r["key"] if isinstance(r, sqlite3.Row) else r[0]] = (
                (r["value"] if isinstance(r, sqlite3.Row) else r[1]) == "1"
            )
        return result

    def set_hq_config(self, partial: dict[str, bool]) -> None:
        for key in partial:
            if key not in HQ_KEYS:
                raise ValueError(f"unknown setting key: {key}")
        for key, val in partial.items():
            self._conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, "1" if val else "0"),
            )
        self._conn.commit()

    def is_onboarding_seen(self) -> bool:
        row = self._conn.execute(
            "SELECT value FROM settings WHERE key='onboarding_seen'"
        ).fetchone()
        if row is None:
            return False
        val = row["value"] if isinstance(row, sqlite3.Row) else row[0]
        return val == "1"

    def mark_onboarding_seen(self) -> None:
        self._conn.execute(
            "INSERT INTO settings (key, value) VALUES ('onboarding_seen', '1') "
            "ON CONFLICT(key) DO UPDATE SET value='1'"
        )
        self._conn.commit()
