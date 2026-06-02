"""
Tests for the watch-folder pipeline (app/watcher.py).

Maintenance notes:
- Each test creates its own isolated WATCH_ROOT (tmp dir).
- No real /watch path is touched.
- Stability cache is module-global — reset via watcher._reset_stability_cache()
  in test setup.
"""
import asyncio
import os
import time
import uuid
from pathlib import Path

import pytest

from app import db
from app import watcher
from app.storage import DocumentRepo, ProjectRepo, WATCH_PROJECT_ID


@pytest.fixture
def watch_root(tmp_path, monkeypatch):
    root = tmp_path / "watch"
    (root / "inbox").mkdir(parents=True)
    (root / "out").mkdir()
    monkeypatch.setenv("WATCH_ROOT", str(root))
    watcher._reset_stability_cache()
    return root


def test_scan_inbox_returns_relpaths_for_top_level_files(watch_root):
    (watch_root / "inbox" / "foo.pdf").write_bytes(b"%PDF-1.4")
    (watch_root / "inbox" / "bar.png").write_bytes(b"\x89PNG\r\n")
    result = list(watcher.scan_inbox(watch_root / "inbox"))
    relpaths = sorted(rel for _, rel in result)
    assert relpaths == ["bar.png", "foo.pdf"]


def test_scan_inbox_recurses_into_subdirectories(watch_root):
    nested = watch_root / "inbox" / "contracts" / "2026"
    nested.mkdir(parents=True)
    (nested / "bar.pdf").write_bytes(b"%PDF-1.4")
    result = list(watcher.scan_inbox(watch_root / "inbox"))
    assert [rel for _, rel in result] == ["contracts/2026/bar.pdf"]


def test_scan_inbox_skips_processed_and_errors_subtrees(watch_root):
    (watch_root / "inbox" / "processed" / "deep").mkdir(parents=True)
    (watch_root / "inbox" / "processed" / "deep" / "old.pdf").write_bytes(b"%PDF")
    (watch_root / "inbox" / "errors").mkdir()
    (watch_root / "inbox" / "errors" / "bad.pdf").write_bytes(b"%PDF")
    (watch_root / "inbox" / "fresh.pdf").write_bytes(b"%PDF")
    result = list(watcher.scan_inbox(watch_root / "inbox"))
    assert [rel for _, rel in result] == ["fresh.pdf"]


def test_scan_inbox_skips_dotfiles_partials_and_unsupported(watch_root):
    (watch_root / "inbox" / ".hidden.pdf").write_bytes(b"%PDF")
    (watch_root / "inbox" / "in_progress.pdf.part").write_bytes(b"%PDF")
    (watch_root / "inbox" / "tmp.tmp").write_bytes(b"%PDF")
    (watch_root / "inbox" / "notes.txt").write_bytes(b"hi")
    (watch_root / "inbox" / "ok.pdf").write_bytes(b"%PDF")
    result = list(watcher.scan_inbox(watch_root / "inbox"))
    assert [rel for _, rel in result] == ["ok.pdf"]


def test_scan_inbox_ignores_symlinks(watch_root, tmp_path):
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"%PDF")
    link = watch_root / "inbox" / "link.pdf"
    os.symlink(str(outside), str(link))
    result = list(watcher.scan_inbox(watch_root / "inbox"))
    assert result == []


def test_scan_inbox_missing_directory_returns_empty(tmp_path):
    result = list(watcher.scan_inbox(tmp_path / "does_not_exist"))
    assert result == []


def test_is_stable_first_seen_returns_false(watch_root):
    p = watch_root / "inbox" / "foo.pdf"
    p.write_bytes(b"%PDF-1.4 abc")
    assert watcher.is_stable(p, stable_secs=0) is False  # first observation


def test_is_stable_after_two_matching_observations_with_old_mtime(watch_root):
    p = watch_root / "inbox" / "foo.pdf"
    p.write_bytes(b"%PDF-1.4 abc")
    # Backdate mtime so it is older than stable_secs.
    past = time.time() - 10
    os.utime(p, (past, past))
    watcher.is_stable(p, stable_secs=3)   # observation 1: records (mtime, size)
    assert watcher.is_stable(p, stable_secs=3) is True  # same (mtime, size) + old enough


def test_is_stable_resets_when_size_changes(watch_root):
    p = watch_root / "inbox" / "foo.pdf"
    p.write_bytes(b"%PDF-1.4 a")
    past = time.time() - 10
    os.utime(p, (past, past))
    watcher.is_stable(p, stable_secs=3)
    # Append more bytes -> size changes -> not stable, cache resets.
    with open(p, "ab") as f:
        f.write(b"more")
    os.utime(p, (past, past))  # same mtime, different size
    assert watcher.is_stable(p, stable_secs=3) is False


def test_is_stable_returns_false_if_mtime_too_recent(watch_root):
    p = watch_root / "inbox" / "foo.pdf"
    p.write_bytes(b"%PDF-1.4 a")
    # mtime is "now" — should not be considered stable even after two observations.
    watcher.is_stable(p, stable_secs=10)
    assert watcher.is_stable(p, stable_secs=10) is False


# ---------------------------------------------------------------------------
# try_ingest tests (T6)
# ---------------------------------------------------------------------------

@pytest.fixture
def watcher_db(tmp_path):
    db_path = tmp_path / "data.db"
    db.init(db_path)
    conn = db.get_connection(db_path)
    try:
        ProjectRepo(conn).ensure_inbox()
        ProjectRepo(conn).ensure_watch_project()
    finally:
        conn.close()
    return db_path


@pytest.fixture
def data_dir(tmp_path):
    d = tmp_path / "data"
    (d / "docs").mkdir(parents=True)
    return d


def test_try_ingest_creates_doc_and_queues(watch_root, watcher_db, data_dir):
    src = watch_root / "inbox" / "foo.pdf"
    src.write_bytes(b"%PDF-1.4 content")
    queue: asyncio.Queue = asyncio.Queue()
    accepted = watcher.try_ingest(
        data_dir=data_dir,
        db_path=watcher_db,
        task_queue=queue,
        abs_path=src,
        rel_path="foo.pdf",
    )
    assert accepted is True
    # Source file remains in place (worker post-hook moves it later).
    assert src.exists()
    # Queue has one entry.
    assert queue.qsize() == 1
    doc_id = queue.get_nowait()
    # DB row exists with expected fields.
    conn = db.get_connection(watcher_db)
    try:
        d = DocumentRepo(conn).get(doc_id)
        assert d["project_id"] == WATCH_PROJECT_ID
        assert d["filename"] == "foo.pdf"
        assert d["source"] == "watch"
        assert d["source_relpath"] == "foo.pdf"
        assert d["status"] == "queued"
        assert d["lang"] == "ru"
        assert d["format"] == "md"
    finally:
        conn.close()


def test_try_ingest_skips_duplicate(watch_root, watcher_db, data_dir):
    src = watch_root / "inbox" / "a" / "foo.pdf"
    src.parent.mkdir(parents=True)
    src.write_bytes(b"%PDF-1.4")
    queue: asyncio.Queue = asyncio.Queue()
    assert watcher.try_ingest(data_dir, watcher_db, queue, src, "a/foo.pdf") is True
    assert watcher.try_ingest(data_dir, watcher_db, queue, src, "a/foo.pdf") is False
    assert queue.qsize() == 1


def test_try_ingest_marks_oversized_as_error_without_queueing(
    watch_root, watcher_db, data_dir, monkeypatch
):
    monkeypatch.setattr(watcher, "_MAX_FILE_SIZE", 10)
    src = watch_root / "inbox" / "huge.pdf"
    src.write_bytes(b"%PDF-1.4 way too large for limit")
    queue: asyncio.Queue = asyncio.Queue()
    accepted = watcher.try_ingest(data_dir, watcher_db, queue, src, "huge.pdf")
    assert accepted is True
    assert queue.qsize() == 0  # not queued for OCR
    conn = db.get_connection(watcher_db)
    try:
        rows = conn.execute(
            "SELECT id, status, error FROM documents WHERE project_id = ? AND source_relpath = ?",
            (WATCH_PROJECT_ID, "huge.pdf"),
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["status"] == "error"
        assert "too large" in rows[0]["error"].lower()
    finally:
        conn.close()


def test_try_ingest_pops_stability_cache_on_success(watch_root, watcher_db, data_dir):
    """Carry-forward from T5 review: cache should not accumulate entries
    for files that get ingested."""
    src = watch_root / "inbox" / "foo.pdf"
    src.write_bytes(b"%PDF-1.4")
    # Prime the cache by calling is_stable (records the path).
    watcher.is_stable(src, stable_secs=0)
    assert src in watcher._stability_cache
    queue: asyncio.Queue = asyncio.Queue()
    watcher.try_ingest(data_dir, watcher_db, queue, src, "foo.pdf")
    assert src not in watcher._stability_cache
