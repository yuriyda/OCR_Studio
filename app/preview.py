"""
Conversion of markdown/docx/text to safe HTML for preview.

Maintenance notes:
- Any HTML that reaches the frontend DOM must pass through sanitize_html().
- The tag and attribute allow-list is the single source of truth; do not duplicate it.
- DOCX conversion was added in Task 11 (this module was extended at that point).
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


import io as _io
import mammoth


def docx_to_html(docx_bytes: bytes) -> str:
    result = mammoth.convert_to_html(_io.BytesIO(docx_bytes))
    return sanitize_html(result.value)
