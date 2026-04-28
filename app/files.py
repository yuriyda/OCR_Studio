"""
Physical document storage management on the filesystem.

Layout: <data_dir>/docs/<doc_id>/{original.<ext>, result.<ext>}.

Maintenance notes:
- No SQLite here — filesystem operations only.
- Input filenames are always normalised via Path(name).name.
- All paths are returned as Path, not str.
"""
from __future__ import annotations

import shutil
from pathlib import Path


def docs_root(data_dir: Path) -> Path:
    return data_dir / "docs"


def doc_dir(data_dir: Path, doc_id: str) -> Path:
    return docs_root(data_dir) / doc_id


def _safe_ext(filename: str) -> str:
    return Path(filename).suffix.lower()


def save_original(data_dir: Path, doc_id: str, content: bytes, filename: str) -> Path:
    dst_dir = doc_dir(data_dir, doc_id)
    dst_dir.mkdir(parents=True, exist_ok=True)
    ext = _safe_ext(filename)
    path = dst_dir / f"original{ext}"
    path.write_bytes(content)
    return path


def save_result(data_dir: Path, doc_id: str, content, format: str) -> Path:
    dst_dir = doc_dir(data_dir, doc_id)
    dst_dir.mkdir(parents=True, exist_ok=True)
    path = dst_dir / f"result.{format}"
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8")
    return path


def original_path(data_dir: Path, doc_id: str) -> Path | None:
    d = doc_dir(data_dir, doc_id)
    if not d.exists():
        return None
    for p in d.iterdir():
        if p.stem == "original":
            return p
    return None


def result_path(data_dir: Path, doc_id: str) -> Path | None:
    d = doc_dir(data_dir, doc_id)
    if not d.exists():
        return None
    for p in d.iterdir():
        if p.stem == "result":
            return p
    return None


SUPPORTED_RESULT_FORMATS = ("md", "txt", "docx")


def result_path_for_format(data_dir: Path, doc_id: str, format: str) -> Path | None:
    """Return path to result.{format} if the file exists, otherwise None.

    Unlike `result_path()` (which finds any result.*), this function
    checks a specific format — needed for format-on-demand endpoints.
    """
    if format not in SUPPORTED_RESULT_FORMATS:
        return None
    p = doc_dir(data_dir, doc_id) / f"result.{format}"
    return p if p.exists() else None


def available_formats(data_dir: Path, doc_id: str) -> list[str]:
    """Return extensions (without dot) of result.* files in the document directory.

    Used by `/api/status` (field `available_formats`) so the UI can disable
    tabs for formats not yet available on legacy documents.
    """
    d = doc_dir(data_dir, doc_id)
    if not d.exists():
        return []
    out = []
    for p in d.iterdir():
        if p.stem == "result" and p.suffix.lstrip(".") in SUPPORTED_RESULT_FORMATS:
            out.append(p.suffix.lstrip("."))
    return out


def delete_doc_dir(data_dir: Path, doc_id: str) -> None:
    shutil.rmtree(doc_dir(data_dir, doc_id), ignore_errors=True)


def list_doc_dirs(data_dir: Path) -> list[str]:
    root = docs_root(data_dir)
    if not root.exists():
        return []
    return [p.name for p in root.iterdir() if p.is_dir()]


def preview_dir(data_dir: Path, doc_id: str) -> Path:
    """Return the preview/ directory inside the document directory.

    Thumbnail cache (thumb_NNN.jpg) and full-page images (page_NNN.jpg) are rendered
    on first request and reused. Deleted together with doc_dir.
    """
    return doc_dir(data_dir, doc_id) / "preview"


def ensure_preview_dir(data_dir: Path, doc_id: str) -> Path:
    """Ensure preview/ exists and return its Path."""
    p = preview_dir(data_dir, doc_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


def preview_thumb_path(data_dir: Path, doc_id: str, page_num: int) -> Path:
    """Path to the page thumbnail (1-indexed). Filename: thumb_NNN.jpg."""
    return preview_dir(data_dir, doc_id) / f"thumb_{page_num:03d}.jpg"


def preview_page_path(data_dir: Path, doc_id: str, page_num: int) -> Path:
    """Path to the full-resolution page image (1-indexed). Filename: page_NNN.jpg."""
    return preview_dir(data_dir, doc_id) / f"page_{page_num:03d}.jpg"
