"""
Lazy rendering of preview pages (thumbnails + full) with on-disk cache.

Maintenance notes:
- Canonical source is original.{pdf,png,...} in data/docs/{id}/.
- Thumbnails (thumb_NNN.jpg) are rendered in batch: render_thumbs() returns all of them.
- Full pages (page_NNN.jpg) are rendered individually: render_page(n).
- All files live in data/docs/{id}/preview/ — deleted together with delete_doc_dir.
- Thumbnail DPI = 80 (compact for the 88 px strip), full-page DPI = 200 (for large view).
- Per-batch progress is exposed via _preview_progress (see Task 19).
"""
from __future__ import annotations

import io
from pathlib import Path

from . import files

THUMB_DPI = 80
THUMB_QUALITY = 70
THUMB_MAX_SIDE = 240  # for the image case

# In-memory per-doc thumb-rendering progress: doc_id → {"current": N, "total": M}.
# Not persisted in DB — ephemeral state of a single process.
_preview_progress: dict[str, dict] = {}

PAGE_DPI = 200
PAGE_QUALITY = 85
PAGE_MAX_SIDE = 1600  # for the image case


def _is_pdf(path: Path) -> bool:
    return path.suffix.lower() == ".pdf"


def render_thumbs(data_dir: Path, doc_id: str, on_page=None) -> list[Path]:
    """Generate (or read from cache) thumbnails for all pages.

    PDF: one thumbnail per page via PyMuPDF @ THUMB_DPI.
    Image: a single thumbnail resized to THUMB_MAX_SIDE.

    Returns a list of paths in page order (1-indexed).
    If a thumbnail already exists on disk it is not re-rendered.

    on_page(current: int, total: int) — optional callback fired after each page.
    Also updates _preview_progress for external polling via get_progress()
    (used in /api/preview/{id}/info → thumbs_progress).
    Progress is cleared after completion (even on exception).
    """
    original = files.original_path(data_dir, doc_id)
    if original is None or not original.exists():
        raise FileNotFoundError(f"original missing for doc {doc_id}")

    files.ensure_preview_dir(data_dir, doc_id)
    paths: list[Path] = []

    if _is_pdf(original):
        import fitz
        with fitz.open(str(original)) as pdf:
            total = pdf.page_count
            try:
                for i in range(total):
                    page_num = i + 1
                    out = files.preview_thumb_path(data_dir, doc_id, page_num)
                    if not out.exists():
                        pix = pdf[i].get_pixmap(dpi=THUMB_DPI)
                        out.write_bytes(pix.tobytes("jpeg", THUMB_QUALITY))
                    paths.append(out)
                    _preview_progress[doc_id] = {"current": page_num, "total": total}
                    if on_page is not None:
                        on_page(page_num, total)
            finally:
                _preview_progress.pop(doc_id, None)
    else:
        from PIL import Image
        out = files.preview_thumb_path(data_dir, doc_id, 1)
        if not out.exists():
            with Image.open(original) as img:
                img.thumbnail((THUMB_MAX_SIDE, THUMB_MAX_SIDE))
                buf = io.BytesIO()
                img.convert("RGB").save(buf, format="JPEG", quality=THUMB_QUALITY)
            out.write_bytes(buf.getvalue())
        paths.append(out)
        if on_page is not None:
            on_page(1, 1)

    return paths


def render_page(data_dir: Path, doc_id: str, page_num: int) -> Path:
    """Generate (or read from cache) a full-resolution page image.

    PDF: page page_num (1-indexed) via PyMuPDF @ PAGE_DPI.
    Image: only page_num=1 is valid.

    Raises:
        FileNotFoundError: original file is missing.
        ValueError: page_num is outside the range [1, total_pages].

    Note: page_num is validated BEFORE the early cache-hit return, so a stale cache
    with an out-of-range page (e.g. after replacing original.pdf with a shorter one)
    does not hide the validation error.
    """
    if page_num < 1:
        raise ValueError(f"page_num must be >= 1, got {page_num}")

    original = files.original_path(data_dir, doc_id)
    if original is None or not original.exists():
        raise FileNotFoundError(f"original missing for doc {doc_id}")

    files.ensure_preview_dir(data_dir, doc_id)
    out = files.preview_page_path(data_dir, doc_id, page_num)

    if _is_pdf(original):
        import fitz
        with fitz.open(str(original)) as pdf:
            if page_num > pdf.page_count:
                raise ValueError(f"page_num {page_num} > pdf.page_count {pdf.page_count}")
            if out.exists():
                return out
            pix = pdf[page_num - 1].get_pixmap(dpi=PAGE_DPI)
            out.write_bytes(pix.tobytes("jpeg", PAGE_QUALITY))
    else:
        if page_num != 1:
            raise ValueError(f"image has only page 1, got {page_num}")
        if out.exists():
            return out
        from PIL import Image
        with Image.open(original) as img:
            img.thumbnail((PAGE_MAX_SIDE, PAGE_MAX_SIDE))
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=PAGE_QUALITY)
        out.write_bytes(buf.getvalue())

    return out


def get_progress(doc_id: str) -> dict | None:
    """Return current thumbnail batch-render progress, or None if not running."""
    return _preview_progress.get(doc_id)
