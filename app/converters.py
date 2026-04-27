"""
Конвертеры результата OCR: markdown → plain txt, markdown → docx.

Редактирование:
- md_to_txt: regex-стрипы только базовые (заголовки, bold/italic).
- md_to_docx: рендерится через markdown→HTML→html_to_docx walker. HTML парсится
  BeautifulSoup, walk по DOM строит python-docx структуры. Inline-парсинг (bold/italic/
  code/links) делегирован markdown library — не дублировать.
- Не добавлять зависимости — bs4, markdown, python-docx уже в requirements.
"""
from __future__ import annotations

import io
import re

from bs4 import BeautifulSoup, NavigableString
from docx import Document
from docx.shared import Pt

from . import preview as _preview


def md_to_txt(md: str) -> str:
    """Strip markdown formatting, keep tables as plain text."""
    lines = md.split("\n")
    out = []
    for line in lines:
        line = re.sub(r"^#{1,6}\s+", "", line)
        line = re.sub(r"\*{1,3}(.+?)\*{1,3}", r"\1", line)
        out.append(line)
    return "\n".join(out)


_HEADING_TAGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 4, "h6": 4}


def html_to_docx(html: str) -> bytes:
    """Walk sanitized HTML → python-docx structures → bytes.

    Поддерживает (в Task 7): h1-h6, p. Списки/inline/code/blockquote/hr/tables —
    в следующих задачах 8-11.
    """
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Arial"
    style.font.size = Pt(11)

    soup = BeautifulSoup(html or "", "html.parser")
    for child in soup.children:
        _walk_block(doc, child)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _walk_block(doc, node):
    """Walk top-level (block) HTML node → docx paragraph/heading."""
    if isinstance(node, NavigableString):
        text = str(node).strip()
        if text:
            doc.add_paragraph(text)
        return
    name = (node.name or "").lower()
    if name in _HEADING_TAGS:
        doc.add_heading(node.get_text().strip(), level=_HEADING_TAGS[name])
        return
    if name == "p":
        doc.add_paragraph(node.get_text().strip())
        return
    if name in ("ul", "ol"):
        style_name = "List Bullet" if name == "ul" else "List Number"
        for li in node.find_all("li", recursive=False):
            doc.add_paragraph(li.get_text().strip(), style=style_name)
        return
    # Other block tags handled in later tasks 9-11.


def md_to_docx(md: str) -> bytes:
    """Convert markdown to a .docx file. Returns bytes.

    Делегирует: markdown → HTML (preview.markdown_to_html) → docx (html_to_docx).
    """
    html = _preview.markdown_to_html(md or "")
    return html_to_docx(html)
