"""
Watch-folder pipeline: detect new files in /watch/inbox/, ingest them into the
existing OCR queue, mirror results to /watch/out/, and bookkeep sources into
/watch/inbox/processed/ or /watch/inbox/errors/.

Maintenance notes:
- All filesystem paths are derived from WATCH_ROOT (env var, default '/watch').
- Tests override WATCH_ROOT via monkeypatch.setenv before importing this module's
  functions. Path constants are NOT cached at import time — every call recomputes
  from os.environ so tests are isolated.
- The stability cache is module-global. Reset via `_reset_stability_cache()` in
  tests; in production it lives for the process lifetime, which is fine because
  ingested files are moved out of inbox by post_process_done.
- ingest never deletes the source; moves happen only inside post_process_*.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Iterator

logger = logging.getLogger(__name__)

# Allowed source extensions — kept in sync with app.main.ALLOWED_EXTENSIONS.
# Duplicated intentionally so watcher does not import main (no circular deps).
_ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif", ".webp"}

# Suffixes that signal "still being written" — user-side convention.
_PARTIAL_SUFFIXES = {".part", ".tmp"}

# Top-level subdirectories under inbox/ that are managed by the watcher and
# must never be scanned for ingestion.
_RESERVED_SUBDIRS = {"processed", "errors"}


def get_watch_root() -> Path:
    return Path(os.environ.get("WATCH_ROOT", "/watch"))


def get_inbox() -> Path:
    return get_watch_root() / "inbox"


def get_out() -> Path:
    return get_watch_root() / "out"


def get_processed() -> Path:
    return get_inbox() / "processed"


def get_errors() -> Path:
    return get_inbox() / "errors"


def scan_inbox(inbox: Path) -> Iterator[tuple[Path, str]]:
    """Yield (absolute_path, relative_path_str) for every ingestable file in `inbox`.

    Filters:
    - inbox itself missing -> empty iterator (no exception).
    - Path must be a regular file (no directories, no symlinks).
    - First path component must not be 'processed' or 'errors'.
    - Basename must not start with '.'.
    - Suffix must be in _ALLOWED_EXTENSIONS and not in _PARTIAL_SUFFIXES.
    """
    if not inbox.exists() or not inbox.is_dir():
        return
    for entry in inbox.rglob("*"):
        try:
            if entry.is_symlink():
                continue
            if not entry.is_file():
                continue
        except OSError:
            # E.g. broken symlink to a removed mount; skip silently.
            continue
        rel = entry.relative_to(inbox)
        parts = rel.parts
        if parts and parts[0] in _RESERVED_SUBDIRS:
            continue
        if entry.name.startswith("."):
            continue
        suffix = entry.suffix.lower()
        if suffix in _PARTIAL_SUFFIXES:
            continue
        if suffix not in _ALLOWED_EXTENSIONS:
            continue
        yield entry, rel.as_posix()


# Stability cache helpers (filled in next task).
_stability_cache: dict[Path, tuple[float, int, float]] = {}


def _reset_stability_cache() -> None:
    """Test helper — clear the in-process stability cache."""
    _stability_cache.clear()
