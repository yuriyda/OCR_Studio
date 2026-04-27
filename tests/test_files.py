"""Unit-тесты для app/files.py."""
from pathlib import Path

from app import files


def test_doc_dir_creates_under_data(tmp_data_dir):
    p = files.doc_dir(tmp_data_dir, "abc123")
    p.mkdir(parents=True)
    assert p == tmp_data_dir / "docs" / "abc123"


def test_save_original(tmp_data_dir):
    path = files.save_original(tmp_data_dir, "abc123", b"hello", "test.pdf")
    assert path.exists()
    assert path.name == "original.pdf"
    assert path.read_bytes() == b"hello"


def test_save_result_md(tmp_data_dir):
    files.save_original(tmp_data_dir, "abc", b"x", "x.pdf")
    path = files.save_result(tmp_data_dir, "abc", "# md", "md")
    assert path.name == "result.md"
    assert path.read_text() == "# md"


def test_save_result_docx(tmp_data_dir):
    files.save_original(tmp_data_dir, "abc", b"x", "x.pdf")
    path = files.save_result(tmp_data_dir, "abc", b"binary", "docx")
    assert path.name == "result.docx"
    assert path.read_bytes() == b"binary"


def test_original_path_resolves(tmp_data_dir):
    files.save_original(tmp_data_dir, "abc", b"x", "test.png")
    assert files.original_path(tmp_data_dir, "abc").name == "original.png"


def test_result_path_resolves(tmp_data_dir):
    files.save_original(tmp_data_dir, "abc", b"x", "x.pdf")
    files.save_result(tmp_data_dir, "abc", "x", "md")
    assert files.result_path(tmp_data_dir, "abc").name == "result.md"


def test_delete_doc_dir(tmp_data_dir):
    files.save_original(tmp_data_dir, "abc", b"x", "x.pdf")
    files.delete_doc_dir(tmp_data_dir, "abc")
    assert not (tmp_data_dir / "docs" / "abc").exists()


def test_list_doc_dirs(tmp_data_dir):
    files.save_original(tmp_data_dir, "a1", b"x", "x.pdf")
    files.save_original(tmp_data_dir, "a2", b"y", "y.pdf")
    assert set(files.list_doc_dirs(tmp_data_dir)) == {"a1", "a2"}


def test_filename_safe_against_traversal(tmp_data_dir):
    path = files.save_original(tmp_data_dir, "abc", b"x", "../../../etc/passwd")
    assert "../" not in str(path)
    assert path.parent == tmp_data_dir / "docs" / "abc"


def test_result_path_for_format_returns_existing(tmp_data_dir):
    from app import files
    files.save_result(tmp_data_dir, "abc12345", "# md", "md")
    p = files.result_path_for_format(tmp_data_dir, "abc12345", "md")
    assert p is not None
    assert p.name == "result.md"


def test_result_path_for_format_returns_none_when_missing(tmp_data_dir):
    from app import files
    files.save_result(tmp_data_dir, "abc12345", "# md", "md")
    p = files.result_path_for_format(tmp_data_dir, "abc12345", "docx")
    assert p is None


def test_available_formats_lists_only_existing(tmp_data_dir):
    from app import files
    files.save_result(tmp_data_dir, "doc99", "# md", "md")
    files.save_result(tmp_data_dir, "doc99", b"PK fake", "docx")
    result = files.available_formats(tmp_data_dir, "doc99")
    assert sorted(result) == ["docx", "md"]


def test_available_formats_empty_for_missing_doc(tmp_data_dir):
    from app import files
    assert files.available_formats(tmp_data_dir, "nonexistent") == []


def test_preview_dir_returns_path_under_doc_dir(tmp_path):
    from app import files
    p = files.preview_dir(tmp_path, "abc123")
    assert p == tmp_path / "docs" / "abc123" / "preview"


def test_preview_thumb_path(tmp_path):
    from app import files
    p = files.preview_thumb_path(tmp_path, "abc123", 1)
    assert p == tmp_path / "docs" / "abc123" / "preview" / "thumb_001.jpg"


def test_preview_thumb_path_pads_to_3_digits(tmp_path):
    from app import files
    p = files.preview_thumb_path(tmp_path, "abc", 42)
    assert p.name == "thumb_042.jpg"


def test_preview_page_path(tmp_path):
    from app import files
    p = files.preview_page_path(tmp_path, "abc123", 5)
    assert p == tmp_path / "docs" / "abc123" / "preview" / "page_005.jpg"


def test_preview_dir_created_by_save_helpers(tmp_path):
    from app import files
    # ensure_preview_dir creates if missing
    d = files.ensure_preview_dir(tmp_path, "abc123")
    assert d.exists() and d.is_dir()
