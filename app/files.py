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


def delete_doc_dir(data_dir: Path, doc_id: str) -> None:
    shutil.rmtree(doc_dir(data_dir, doc_id), ignore_errors=True)


def list_doc_dirs(data_dir: Path) -> list[str]:
    root = docs_root(data_dir)
    if not root.exists():
        return []
    return [p.name for p in root.iterdir() if p.is_dir()]
