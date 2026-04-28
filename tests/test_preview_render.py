"""Tests for preview_render: lazy generation of thumbnails and full pages with disk cache."""
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def pdf_doc(tmp_path):
    """Create a minimal valid 3-page PDF via PyMuPDF."""
    import fitz
    docs = tmp_path / "docs" / "doc1"
    docs.mkdir(parents=True)
    pdf = fitz.open()
    for _ in range(3):
        pdf.new_page(width=200, height=200)
    pdf.save(str(docs / "original.pdf"))
    pdf.close()
    return tmp_path, "doc1"


def test_render_thumbs_creates_files_for_each_page(pdf_doc):
    from app import preview_render, files
    data_dir, doc_id = pdf_doc
    paths = preview_render.render_thumbs(data_dir, doc_id)
    assert len(paths) == 3
    for i, p in enumerate(paths, start=1):
        assert p == files.preview_thumb_path(data_dir, doc_id, i)
        assert p.exists()
        assert p.stat().st_size > 0


def test_render_thumbs_idempotent_uses_cache(pdf_doc):
    from app import preview_render, files
    data_dir, doc_id = pdf_doc
    preview_render.render_thumbs(data_dir, doc_id)
    first_mtime = files.preview_thumb_path(data_dir, doc_id, 1).stat().st_mtime
    # Second call must reuse cache, not re-render
    preview_render.render_thumbs(data_dir, doc_id)
    second_mtime = files.preview_thumb_path(data_dir, doc_id, 1).stat().st_mtime
    assert first_mtime == second_mtime, "thumb was re-rendered (cache miss)"


def test_render_thumbs_for_image_returns_single_thumb(tmp_path):
    from PIL import Image
    from app import preview_render, files
    docs = tmp_path / "docs" / "img1"
    docs.mkdir(parents=True)
    Image.new("RGB", (400, 300), "white").save(str(docs / "original.png"))
    paths = preview_render.render_thumbs(tmp_path, "img1")
    assert len(paths) == 1
    assert paths[0] == files.preview_thumb_path(tmp_path, "img1", 1)
    assert paths[0].exists()


def test_render_thumbs_missing_original_raises(tmp_path):
    from app import preview_render
    with pytest.raises(FileNotFoundError):
        preview_render.render_thumbs(tmp_path, "nonexistent")


def test_render_page_creates_full_resolution_jpg(pdf_doc):
    from app import preview_render, files
    data_dir, doc_id = pdf_doc
    p = preview_render.render_page(data_dir, doc_id, 2)
    assert p == files.preview_page_path(data_dir, doc_id, 2)
    assert p.exists() and p.stat().st_size > 0


def test_render_page_idempotent_uses_cache(pdf_doc):
    from app import preview_render, files
    data_dir, doc_id = pdf_doc
    preview_render.render_page(data_dir, doc_id, 1)
    first_mtime = files.preview_page_path(data_dir, doc_id, 1).stat().st_mtime
    preview_render.render_page(data_dir, doc_id, 1)
    second_mtime = files.preview_page_path(data_dir, doc_id, 1).stat().st_mtime
    assert first_mtime == second_mtime


def test_render_page_invalid_page_num_raises(pdf_doc):
    from app import preview_render
    data_dir, doc_id = pdf_doc
    # 3-page PDF, requesting page 5
    with pytest.raises(ValueError, match="page"):
        preview_render.render_page(data_dir, doc_id, 5)


def test_render_page_for_image_only_page_1_valid(tmp_path):
    from PIL import Image
    from app import preview_render
    docs = tmp_path / "docs" / "img1"
    docs.mkdir(parents=True)
    Image.new("RGB", (400, 300), "white").save(str(docs / "original.png"))
    p = preview_render.render_page(tmp_path, "img1", 1)
    assert p.exists()
    with pytest.raises(ValueError):
        preview_render.render_page(tmp_path, "img1", 2)


def test_render_page_validates_against_stale_cache(pdf_doc):
    """Stale cache (e.g. after replacing original.pdf with a shorter one) must not hide
    a ValueError for an invalid page_num. Regression test for bug I1 from code review Task 3."""
    from app import preview_render, files
    data_dir, doc_id = pdf_doc  # 3-page PDF
    files.ensure_preview_dir(data_dir, doc_id)
    fake = files.preview_page_path(data_dir, doc_id, 99)
    fake.write_bytes(b"stale")
    with pytest.raises(ValueError, match="page"):
        preview_render.render_page(data_dir, doc_id, 99)


def test_get_progress_returns_none_when_not_rendering():
    from app import preview_render
    assert preview_render.get_progress("nonexistent_doc") is None


def test_render_thumbs_updates_progress_during_batch(pdf_doc):
    """While render_thumbs is running, on_page callback fires per page;
    after it returns, progress is cleared to None.
    """
    from app import preview_render
    data_dir, doc_id = pdf_doc

    snapshots = []
    def hook(cur, total):
        snapshots.append((cur, total))

    preview_render.render_thumbs(data_dir, doc_id, on_page=hook)
    # After completion: progress cleared
    assert preview_render.get_progress(doc_id) is None
    # Mid-iteration: hook called per page (3-page PDF fixture)
    assert snapshots == [(1, 3), (2, 3), (3, 3)]
