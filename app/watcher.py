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

import asyncio
import logging
import os
import shutil
import time as _time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from . import db as _db
from . import files as _files
from .limits import MAX_FILE_SIZE as _MAX_FILE_SIZE
from .storage import DocumentRepo, WATCH_PROJECT_ID

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


# Stability cache helpers.
# Key: Path; Value: (mtime, size).
_stability_cache: dict[Path, tuple[float, int]] = {}


def _reset_stability_cache() -> None:
    """Test helper — clear the in-process stability cache."""
    _stability_cache.clear()


def is_stable(path: Path, stable_secs: int) -> bool:
    """Return True iff `path` has been observed at least twice with the same
    (mtime, size) AND its mtime is at least `stable_secs` seconds in the past.

    The double-observation requirement protects against a file that grows
    monotonically (e.g. a long upload over a slow link). The mtime-age check
    protects against a file that finished writing at the exact moment of the
    first observation but might still be inside a buffered-write window.
    """
    try:
        st = path.stat()
    except OSError:
        _stability_cache.pop(path, None)
        return False
    now = _time.time()
    prev = _stability_cache.get(path)
    if prev is None or prev[0] != st.st_mtime or prev[1] != st.st_size:
        _stability_cache[path] = (st.st_mtime, st.st_size)
        return False
    return (now - st.st_mtime) >= stable_secs


# Watcher always runs OCR in Russian — hardcoded per project decision.
_WATCH_LANG = "ru"


def try_ingest(
    data_dir: Path,
    db_path: Path,
    task_queue,
    abs_path: Path,
    rel_path: str,
) -> bool:
    """Ingest `abs_path` into the Watch project and enqueue it for OCR.

    Returns True if a new DB row was created (queued or error), False if the
    file was deduplicated (already in pipeline) and should be left alone.

    Oversized files (> _MAX_FILE_SIZE) are recorded as status='error', NOT
    enqueued, and their source is moved to errors/ (with a sidecar) right here:
    the worker post-hook never runs for them, and a file left in inbox would be
    re-ingested as a fresh error row on every scan cycle.

    On success or oversize-error, the stability-cache entry for `abs_path` is
    evicted: the file is about to leave the inbox via post_process_done/error,
    so retaining its (mtime, size) pair would only grow the cache.
    """
    conn = _db.get_connection(db_path)
    try:
        doc_repo = DocumentRepo(conn)
        if doc_repo.exists_active_by_relpath(WATCH_PROJECT_ID, rel_path):
            return False
        try:
            content = abs_path.read_bytes()
        except OSError as e:
            logger.warning("watcher: cannot read %s: %s", abs_path, e)
            return False
        doc_id = uuid.uuid4().hex[:12]
        filename = abs_path.name
        if len(content) > _MAX_FILE_SIZE:
            error_message = f"file too large ({len(content)} bytes, max {_MAX_FILE_SIZE})"
            doc_repo.create(
                doc_id=doc_id,
                project_id=WATCH_PROJECT_ID,
                filename=filename,
                format="md",
                lang=_WATCH_LANG,
                size_bytes=len(content),
                source="watch",
                source_relpath=rel_path,
            )
            doc_repo.update(doc_id, status="error", error=error_message)
            # The doc is never queued, so the worker post-hook can't move the
            # source out of inbox — do it now, otherwise the next scan re-ingests
            # the same file as a new error row, endlessly.
            post_process_error(
                data_dir,
                {
                    "id": doc_id,
                    "filename": filename,
                    "source": "watch",
                    "source_relpath": rel_path,
                },
                error_message,
            )
            _stability_cache.pop(abs_path, None)
            return True
        # Save a physical copy into data/docs/<doc_id>/original.<ext> so the
        # worker can process it even after the source is moved to processed/.
        _files.save_original(data_dir, doc_id, content, filename)
        doc_repo.create(
            doc_id=doc_id,
            project_id=WATCH_PROJECT_ID,
            filename=filename,
            format="md",
            lang=_WATCH_LANG,
            size_bytes=len(content),
            source="watch",
            source_relpath=rel_path,
        )
    finally:
        conn.close()
    # asyncio.Queue.put_nowait is safe from a sync caller when the queue is
    # unbounded (maxsize=0). The watcher uses the same queue as main.py creates
    # with asyncio.Queue() (no maxsize), so this is always safe.
    task_queue.put_nowait(doc_id)
    _stability_cache.pop(abs_path, None)
    return True


def _path_with_collision_suffix(target: Path) -> Path:
    """Return `target` if it does not exist, otherwise `target` with a `_1`, `_2`, ...
    suffix before the extension. Same convention as /api/projects/{id}/zip.
    """
    if not target.exists():
        return target
    stem = target.stem
    suffix = target.suffix
    parent = target.parent
    n = 1
    while True:
        candidate = parent / f"{stem}_{n}{suffix}"
        if not candidate.exists():
            return candidate
        n += 1


def post_process_done(data_dir: Path, doc: dict) -> None:
    """File-system bookkeeping for a watcher document that finished OCR.

    1. Copy result.md to /watch/out/<rel_dir>/<stem>.md (with collision suffix).
    2. Move /watch/inbox/<rel> to /watch/inbox/processed/<rel>.

    Both steps are best-effort: if the source file is gone, we still write the
    result; if mkdir/copy/move fails, we log and return. The DB document
    remains as-is.
    """
    if doc.get("source") != "watch":
        return
    rel_str = doc.get("source_relpath")
    if not rel_str:
        return
    rel = Path(rel_str)

    # 1. Copy result.md to /watch/out/.
    try:
        result_md = _files.result_path_for_format(data_dir, doc["id"], "md")
        if result_md is not None:
            out_target = get_out() / rel.parent / f"{rel.stem}.md"
            out_target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(result_md), str(_path_with_collision_suffix(out_target)))
    except Exception:
        logger.exception(
            "watcher: failed to copy result.md to /watch/out for %s", doc["id"]
        )

    # 2. Move source -> processed/.
    try:
        src = get_inbox() / rel
        if src.exists():
            dst = _path_with_collision_suffix(get_processed() / rel)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
    except Exception:
        logger.exception(
            "watcher: failed to move source to processed/ for %s", doc["id"]
        )


def post_process_error(data_dir: Path, doc: dict, error_message: str) -> None:
    """File-system bookkeeping for a watcher document that failed OCR.

    1. Move /watch/inbox/<rel> to /watch/inbox/errors/<rel> (if source still exists).
    2. Write /watch/inbox/errors/<rel>.error.txt with doc id + timestamp + message.

    Sidecar is written even when the source has vanished — this preserves a
    breadcrumb for the user.
    """
    if doc.get("source") != "watch":
        return
    rel_str = doc.get("source_relpath")
    if not rel_str:
        return
    rel = Path(rel_str)

    try:
        src = get_inbox() / rel
        if src.exists():
            dst = _path_with_collision_suffix(get_errors() / rel)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
    except Exception:
        logger.exception("watcher: failed to move source to errors/ for %s", doc["id"])

    try:
        sidecar = get_errors() / f"{rel}.error.txt"
        sidecar.parent.mkdir(parents=True, exist_ok=True)
        body = (
            f"doc_id: {doc.get('id')}\n"
            f"filename: {doc.get('filename')}\n"
            f"source_relpath: {rel_str}\n"
            f"timestamp: {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n"
            f"\n"
            f"{error_message}\n"
        )
        sidecar.write_text(body, encoding="utf-8")
    except Exception:
        logger.exception("watcher: failed to write error sidecar for %s", doc["id"])


async def watcher_loop(
    data_dir: Path,
    db_path: Path,
    task_queue: asyncio.Queue,
    reload_state: dict,
    interval: float = 5.0,
    stable_secs: int = 3,
) -> None:
    """Background asyncio task: scan the inbox every `interval` seconds and
    ingest stable files.

    - `reload_state` is the shared dict from app.main._reload_state. When its
      'done' flag is False (engine reload in progress), the watcher skips the
      ingest pass to avoid racing with PUT /api/settings.
    - Exceptions inside the loop are logged and never propagate; the loop
      remains alive for the process lifetime.
    """
    logger.info(
        "watcher: starting (watch_root=%s, interval=%.1fs, stable_secs=%ds)",
        get_watch_root(), interval, stable_secs,
    )
    while True:
        try:
            if reload_state.get("done") is False:
                await asyncio.sleep(interval)
                continue
            inbox = get_inbox()
            for abs_path, rel_path in scan_inbox(inbox):
                if not is_stable(abs_path, stable_secs):
                    continue
                try:
                    try_ingest(
                        data_dir=data_dir,
                        db_path=db_path,
                        task_queue=task_queue,
                        abs_path=abs_path,
                        rel_path=rel_path,
                    )
                except Exception:
                    logger.exception("watcher: try_ingest failed for %s", abs_path)
        except Exception:
            logger.exception("watcher: scan cycle failed")
        await asyncio.sleep(interval)
