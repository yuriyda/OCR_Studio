"""
Lazy-рендер preview-страниц (миниатюры + full) с кэшем на диске.

Редактирование:
- Канонический источник — original.{pdf,png,...} в data/docs/{id}/.
- Миниатюры (thumb_NNN.jpg) рендерятся batch'ем: render_thumbs() возвращает все.
- Full-страницы (page_NNN.jpg) рендерятся по одной: render_page(n).
- Все файлы лежат в data/docs/{id}/preview/ — удаляются с delete_doc_dir.
- DPI миниатюр 80 (компактно для strip 88px), DPI full 200 (для крупного просмотра).
- Прогресс per-batch отдаётся через _preview_progress (см. Task 19).
"""
from __future__ import annotations

import io
from pathlib import Path

from . import files

THUMB_DPI = 80
THUMB_QUALITY = 70
THUMB_MAX_SIDE = 240  # для image-кейса

PAGE_DPI = 200
PAGE_QUALITY = 85
PAGE_MAX_SIDE = 1600  # для image-кейса


def _is_pdf(path: Path) -> bool:
    return path.suffix.lower() == ".pdf"


def render_thumbs(data_dir: Path, doc_id: str) -> list[Path]:
    """Сгенерировать (или прочитать из кэша) миниатюры всех страниц.

    PDF: по странице через PyMuPDF @ THUMB_DPI.
    Image: один thumbnail с уменьшением до THUMB_MAX_SIDE.

    Возвращает список путей в порядке страниц (1-indexed).
    Если миниатюра уже на диске — повторно не рендерим.
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
            for i in range(total):
                page_num = i + 1
                out = files.preview_thumb_path(data_dir, doc_id, page_num)
                if not out.exists():
                    pix = pdf[i].get_pixmap(dpi=THUMB_DPI)
                    out.write_bytes(pix.tobytes("jpeg", THUMB_QUALITY))
                paths.append(out)
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

    return paths


def render_page(data_dir: Path, doc_id: str, page_num: int) -> Path:
    """Сгенерировать (или прочитать из кэша) full-разрешение страницы.

    PDF: страница page_num (1-indexed) через PyMuPDF @ PAGE_DPI.
    Image: только page_num=1.

    Raises:
        FileNotFoundError: original отсутствует.
        ValueError: page_num вне диапазона [1, total_pages].

    Note: page_num валидируется ДО раннего возврата по cache hit, чтобы stale-кэш
    с битой страницей (например, после замены original.pdf на более короткий)
    не затенял ошибку валидации.
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
