"""
Управление физическим хранилищем документов на файловой системе.

Раскладка: <data_dir>/docs/<doc_id>/{original.<ext>, result.<ext>}.

Редактирование:
- Не использовать тут sqlite — только FS-операции.
- Имена входных файлов всегда нормализуются через Path(name).name.
- Все пути возвращаются как Path, не str.
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
    """Путь к result.{format} если файл существует, иначе None.

    В отличие от `result_path()` (ищет любой result.*), эта функция
    проверяет конкретный формат — нужно для format-on-demand endpoint'ов.
    """
    if format not in SUPPORTED_RESULT_FORMATS:
        return None
    p = doc_dir(data_dir, doc_id) / f"result.{format}"
    return p if p.exists() else None


def available_formats(data_dir: Path, doc_id: str) -> list[str]:
    """Список расширений (без точки) файлов result.* в папке документа.

    Используется в `/api/status` (поле `available_formats`), чтобы UI
    мог disabled-ить недоступные табы legacy-документов.
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
    """Папка preview/ внутри директории документа.

    Кэш миниатюр (thumb_NNN.jpg) и full-страниц (page_NNN.jpg) рендерится
    при первом запросе и переиспользуется. Удаляется вместе с doc_dir.
    """
    return doc_dir(data_dir, doc_id) / "preview"


def ensure_preview_dir(data_dir: Path, doc_id: str) -> Path:
    """Гарантирует существование preview/, возвращает Path."""
    p = preview_dir(data_dir, doc_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


def preview_thumb_path(data_dir: Path, doc_id: str, page_num: int) -> Path:
    """Путь к миниатюре страницы (1-indexed). Имя: thumb_NNN.jpg."""
    return preview_dir(data_dir, doc_id) / f"thumb_{page_num:03d}.jpg"


def preview_page_path(data_dir: Path, doc_id: str, page_num: int) -> Path:
    """Путь к full-разрешению странице (1-indexed). Имя: page_NNN.jpg."""
    return preview_dir(data_dir, doc_id) / f"page_{page_num:03d}.jpg"
