"""Тесты для app/preview.py."""
from app import preview


def test_markdown_headings():
    html = preview.markdown_to_html("# Title\n## Sub")
    assert "<h1>Title</h1>" in html
    assert "<h2>Sub</h2>" in html


def test_markdown_table():
    md = "| A | B |\n| --- | --- |\n| 1 | 2 |"
    html = preview.markdown_to_html(md)
    assert "<table>" in html
    assert "<th>A</th>" in html
    assert "<td>1</td>" in html


def test_markdown_lists():
    html = preview.markdown_to_html("- a\n- b")
    assert "<ul>" in html
    assert "<li>a</li>" in html


def test_markdown_fenced_code():
    html = preview.markdown_to_html("```\ncode\n```")
    assert "<code>" in html
    assert "code" in html


def test_markdown_emphasis():
    html = preview.markdown_to_html("*em* and **bold**")
    assert "<em>em</em>" in html
    assert "<strong>bold</strong>" in html


def test_sanitize_strips_script():
    bad = "<p>hi</p><script>alert(1)</script>"
    clean = preview.sanitize_html(bad)
    assert "<script" not in clean
    assert "<p>hi</p>" in clean


def test_sanitize_strips_iframe():
    clean = preview.sanitize_html('<iframe src="x"></iframe><p>ok</p>')
    assert "<iframe" not in clean


def test_sanitize_strips_event_handlers():
    clean = preview.sanitize_html('<p onerror="alert(1)">x</p>')
    assert "onerror" not in clean


def test_sanitize_strips_javascript_href():
    clean = preview.sanitize_html('<a href="javascript:alert(1)">x</a>')
    assert "javascript:" not in clean


def test_sanitize_keeps_table_attrs():
    clean = preview.sanitize_html('<table><tr><td colspan="2">x</td></tr></table>')
    assert 'colspan="2"' in clean


def test_text_to_html_wraps_in_pre():
    clean = preview.text_to_html("a\nb\n<script>")
    assert "<pre>" in clean
    assert "&lt;script&gt;" in clean
    assert "<script>" not in clean
