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
