"""
Обёртка над PaddleOCR PPStructureV3.

Редактирование:
- Не менять public-API `process_file(file_path, lang, progress_callback)` без согласования —
  его вызывает worker в app/main.py.
- Фикс порядка колонок таблиц через сортировку по X-координате (`html_table_to_markdown`)
  не удалять — он чинит баг SLANet (см. memory.md «Table Column Order Fix»).
- progress_callback вызывается в начале обработки каждой страницы (1-based).
"""

import logging
from pathlib import Path

from bs4 import BeautifulSoup
from paddleocr import PPStructureV3

logger = logging.getLogger(__name__)

_engine: PPStructureV3 | None = None
_engine_lang: str = "ru"


def get_engine(lang: str = "ru") -> PPStructureV3:
    """Return (and lazily initialize) the shared PPStructureV3 engine."""
    global _engine, _engine_lang
    if _engine is None or _engine_lang != lang:
        logger.info("Loading PPStructureV3 models (lang=%s, this may take ~30 s)...", lang)
        _engine = PPStructureV3(use_table_recognition=True, lang=lang)
        _engine_lang = lang
        logger.info("PPStructureV3 ready.")
    return _engine


def html_table_to_markdown(html: str, cell_boxes: list | None = None) -> str:
    """Convert an HTML table to a markdown table, reordering cells by X-coordinate."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if not table:
        return html

    rows = table.find_all("tr")
    if not rows:
        return html

    all_html_cells = []
    for row in rows:
        all_html_cells.extend(row.find_all(["td", "th"]))

    if not (cell_boxes and len(cell_boxes) == len(all_html_cells)):
        num_cols = len(rows[0].find_all(["td", "th"]))
        md_rows = []
        for row in rows:
            cells = row.find_all(["td", "th"])
            md_rows.append("| " + " | ".join(c.get_text(strip=True) for c in cells) + " |")
        if md_rows:
            md_rows.insert(1, "| " + " | ".join(["---"] * num_cols) + " |")
        return "\n".join(md_rows)

    row_cell_counts = [len(row.find_all(["td", "th"])) for row in rows]
    num_cols = max(row_cell_counts)

    box_idx = 0
    col_centers = None
    for ri, row in enumerate(rows):
        n = row_cell_counts[ri]
        if n == num_cols and col_centers is None:
            items = []
            for ci in range(n):
                box = cell_boxes[box_idx + ci]
                items.append((box[0] + box[2]) / 2)
            items.sort()
            col_centers = items
        box_idx += n

    md_rows = []
    box_idx = 0
    for ri, row in enumerate(rows):
        cells = row.find_all(["td", "th"])
        n = len(cells)

        row_items = []
        for ci in range(n):
            box = cell_boxes[box_idx + ci]
            x_center = (box[0] + box[2]) / 2
            text = cells[ci].get_text(strip=True)
            row_items.append((x_center, text))
        box_idx += n
        row_items.sort(key=lambda t: t[0])

        if n < num_cols and col_centers:
            output = [""] * num_cols
            for x, text in row_items:
                best_col = min(range(num_cols), key=lambda c: abs(col_centers[c] - x))
                output[best_col] = text
            md_rows.append("| " + " | ".join(output) + " |")
        else:
            md_rows.append("| " + " | ".join(t for _, t in row_items) + " |")

    if md_rows:
        md_rows.insert(1, "| " + " | ".join(["---"] * num_cols) + " |")

    return "\n".join(md_rows)


def page_to_markdown(page_result, page_num: int) -> str:
    """Convert a single page PPStructureV3 result to markdown."""
    j = page_result.json["res"]
    blocks = j.get("parsing_res_list", [])
    table_res_list = j.get("table_res_list", [])

    if not blocks:
        return f"## Page {page_num}\n\n*(empty page)*\n"

    parts = [f"## Page {page_num}\n"]

    table_idx = 0
    for block in sorted(blocks, key=lambda b: (b.get("block_bbox") or [0, 0])[1]):
        label = block.get("block_label", "")
        content = block.get("block_content", "").strip()

        if not content:
            continue

        if label == "table":
            cell_boxes = None
            if table_idx < len(table_res_list):
                cell_boxes = table_res_list[table_idx].get("cell_box_list")
            table_idx += 1
            parts.append(html_table_to_markdown(content, cell_boxes))
            parts.append("")
        elif label in ("figure_title", "doc_title"):
            parts.append(f"### {content}\n")
        elif label == "paragraph_title":
            parts.append(f"#### {content}\n")
        else:
            parts.append(content)
            parts.append("")

    return "\n".join(parts)


def process_file(
    file_path: str,
    lang: str = "ru",
    progress_callback=None,
) -> str:
    """Run OCR on a file and return the result as a markdown string.

    progress_callback(current_page: int, total_pages: int) — вызывается в начале обработки каждой страницы (current_page 1-based).
    """
    engine = get_engine(lang)
    path = Path(file_path)

    # Pre-count pages для PDF; для image — всегда 1
    total_pages = 1
    if path.suffix.lower() == ".pdf":
        import fitz
        with fitz.open(str(file_path)) as doc:
            total_pages = doc.page_count

    result = engine.predict(str(file_path))

    md_parts = [f"# {path.stem}\n"]
    for page_idx, page_result in enumerate(result):
        if progress_callback is not None:
            progress_callback(page_idx + 1, total_pages)
        md_parts.append(page_to_markdown(page_result, page_idx + 1))

    return "\n".join(md_parts)
