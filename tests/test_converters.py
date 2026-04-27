"""Тесты конвертера markdown → docx (через html_to_docx walker)."""
from __future__ import annotations

import io

import pytest
from docx import Document
from docx.document import Document as DocxDocument

from app.converters import html_to_docx, md_to_docx


def _open_docx(data: bytes) -> DocxDocument:
    return Document(io.BytesIO(data))


def test_html_to_docx_simple_paragraph():
    data = html_to_docx("<p>hello world</p>")
    doc = _open_docx(data)
    paras = [p.text for p in doc.paragraphs if p.text]
    assert paras == ["hello world"]


def test_html_to_docx_h1_h2_h3():
    data = html_to_docx("<h1>Title</h1><h2>Section</h2><h3>Sub</h3>")
    doc = _open_docx(data)
    headings = [p for p in doc.paragraphs if p.style.name.startswith("Heading")]
    assert len(headings) == 3
    assert headings[0].text == "Title"
    assert headings[0].style.name == "Heading 1"
    assert headings[1].style.name == "Heading 2"
    assert headings[2].style.name == "Heading 3"


def test_html_to_docx_h4_h5_h6_clamped_to_4():
    data = html_to_docx("<h6>Deep</h6>")
    doc = _open_docx(data)
    headings = [p for p in doc.paragraphs if p.style.name.startswith("Heading")]
    assert len(headings) == 1
    assert headings[0].style.name in ("Heading 4",)


def test_html_to_docx_multiple_paragraphs_keep_order():
    data = html_to_docx("<p>first</p><p>second</p><p>third</p>")
    doc = _open_docx(data)
    paras = [p.text for p in doc.paragraphs if p.text]
    assert paras == ["first", "second", "third"]


def test_html_to_docx_empty_input_returns_valid_docx():
    data = html_to_docx("")
    doc = _open_docx(data)
    assert isinstance(doc, DocxDocument)


def test_html_to_docx_unordered_list():
    data = html_to_docx("<ul><li>alpha</li><li>beta</li><li>gamma</li></ul>")
    doc = _open_docx(data)
    bullets = [p for p in doc.paragraphs if p.style.name == "List Bullet"]
    assert len(bullets) == 3
    assert [p.text for p in bullets] == ["alpha", "beta", "gamma"]


def test_html_to_docx_ordered_list():
    data = html_to_docx("<ol><li>one</li><li>two</li></ol>")
    doc = _open_docx(data)
    nums = [p for p in doc.paragraphs if p.style.name == "List Number"]
    assert len(nums) == 2
    assert [p.text for p in nums] == ["one", "two"]


def test_html_to_docx_list_then_paragraph():
    data = html_to_docx("<ul><li>x</li><li>y</li></ul><p>after</p>")
    doc = _open_docx(data)
    visible = [(p.style.name, p.text) for p in doc.paragraphs if p.text]
    assert visible == [
        ("List Bullet", "x"),
        ("List Bullet", "y"),
        ("Normal", "after"),
    ]
