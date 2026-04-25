"""Converters: markdown -> txt, markdown -> docx."""

import io
import re

from docx import Document
from docx.shared import Pt


def md_to_txt(md: str) -> str:
    """Strip markdown formatting, keep tables as plain text."""
    lines = md.split("\n")
    out = []
    for line in lines:
        # Remove heading markers
        line = re.sub(r"^#{1,6}\s+", "", line)
        # Remove bold/italic
        line = re.sub(r"\*{1,3}(.+?)\*{1,3}", r"\1", line)
        out.append(line)
    return "\n".join(out)


def md_to_docx(md: str) -> bytes:
    """Convert markdown to a .docx file. Returns bytes."""
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Arial"
    style.font.size = Pt(11)

    lines = md.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]

        # Headings
        if line.startswith("# "):
            level = 0
            stripped = line.lstrip("#")
            level = len(line) - len(stripped)
            level = min(level, 4)
            doc.add_heading(stripped.strip(), level=level)
            i += 1
            continue

        # Table: collect consecutive lines starting with |
        if line.startswith("|"):
            table_lines = []
            while i < len(lines) and lines[i].startswith("|"):
                # Skip separator rows
                if re.match(r"^\|[\s\-:|]+\|$", lines[i]):
                    i += 1
                    continue
                table_lines.append(lines[i])
                i += 1

            if table_lines:
                rows_data = []
                for tl in table_lines:
                    cells = [c.strip() for c in tl.strip("|").split("|")]
                    rows_data.append(cells)

                num_cols = max(len(r) for r in rows_data)
                table = doc.add_table(rows=len(rows_data), cols=num_cols)
                table.style = "Table Grid"
                for ri, row_data in enumerate(rows_data):
                    for ci, cell_text in enumerate(row_data):
                        if ci < num_cols:
                            table.rows[ri].cells[ci].text = cell_text
                doc.add_paragraph("")
            continue

        # Empty line
        if not line.strip():
            i += 1
            continue

        # Regular paragraph
        doc.add_paragraph(line)
        i += 1

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
