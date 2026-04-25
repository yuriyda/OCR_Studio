"""
Конвертация markdown/docx/text в безопасный HTML для preview.

Редактирование:
- Любой HTML, попадающий в DOM на фронте, должен пройти sanitize_html().
- Allow-list тегов и атрибутов — единственное место правды; не дублировать.
- DOCX-конвертация добавляется в Task 11 (этот модуль расширяется).
"""
from __future__ import annotations

import html as _html

import bleach
import markdown as _markdown

ALLOWED_TAGS = {
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "strong", "em",
    "code", "pre", "blockquote",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tr", "th", "td",
    "a",
}
ALLOWED_ATTRS = {
    "a": ["href"],
    "td": ["align", "colspan", "rowspan"],
    "th": ["align", "colspan", "rowspan"],
}
ALLOWED_PROTOCOLS = ["http", "https"]


def markdown_to_html(md: str) -> str:
    raw = _markdown.markdown(
        md or "",
        extensions=["tables", "fenced_code", "sane_lists"],
    )
    return sanitize_html(raw)


def text_to_html(text: str) -> str:
    escaped = _html.escape(text or "")
    return sanitize_html(f"<pre>{escaped}</pre>")


def sanitize_html(html: str) -> str:
    return bleach.clean(
        html or "",
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
        strip_comments=True,
    )
