"""
Tests for the watch-folder pipeline (app/watcher.py).

Maintenance notes:
- Each test creates its own isolated WATCH_ROOT (tmp dir).
- No real /watch path is touched.
- Stability cache is module-global — reset via watcher._reset_stability_cache()
  in test setup.
"""
import os
import time
from pathlib import Path

import pytest

from app import watcher


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
