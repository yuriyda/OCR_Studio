"""
Wrapper around PaddleOCR PPStructureV3.

Maintenance notes:
- OCR engine language is fixed to 'ru' (cyrillic model). Do not re-add a lang parameter
  without discussion — see spec ux-cleanup §2.
- Public API: `process_file(file_path, progress_callback=None, stage_callback=None)`.
  Called by the worker in app/main.py.
- The table column order fix via X-coordinate sorting (`html_table_to_markdown`)
  must not be removed — it corrects a SLANet bug (see memory.md 'Table Column Order Fix').
- progress_callback is called at the start and end of each page (1-based).
- stage_callback is called before each sub-model pipeline invocation (layout/text/table/formula).
- PDF is split into single-page files via PyMuPDF — predict() is called per page.
  This provides real progress at the cost of losing PaddleOCR batch optimisations (~30-50% slower).
"""

import logging
from pathlib import Path

from bs4 import BeautifulSoup
from paddleocr import PPStructureV3

logger = logging.getLogger(__name__)

_engine: PPStructureV3 | None = None

# List of key PPStructureV3 pipeline models. Used in /api/system and
# stage_label ("Loading models: ..."). Names correspond to directories in
# /home/node/.paddlex/official_models/. Update only on PaddleOCR upgrades.
PIPELINE_MODELS: list[dict] = [
    {"role": "layout",   "name": "PicoDet-S_layout_3cls"},
    {"role": "text_det", "name": "PP-OCRv5_server_det"},
    {"role": "text_rec", "name": "cyrillic_PP-OCRv3"},
    {"role": "table",    "name": "SLANet_plus + RT-DETR-L_wired_table_cell_det"},
    {"role": "formula",  "name": "PP-FormulaNet_plus-L"},
]


class _Hooked:
    """Callable proxy that fires callback(name) before delegating to inner.

    Used by install_stage_hooks to wrap sub-model attributes of paddlex_pipeline.
    Callback errors are isolated — they do not break the OCR process.
    """

    def __init__(self, inner, callback, name):
        self.inner = inner
        self.callback = callback
        self.name = name

    def __call__(self, *args, **kwargs):
        try:
            self.callback(self.name)
        except Exception:
            pass  # callback errors must NOT break OCR
        return self.inner(*args, **kwargs)

    def __getattr__(self, item):
        # Forward attribute access to inner (some pipeline code reads .device, .model_name etc.)
        return getattr(self.inner, item)


def install_stage_hooks(engine, on_stage_start) -> None:
    """Wrap sub-models on engine's INTERNAL pipeline(s) so on_stage_start(name) fires
    before each model invocation. Side-effect: replaces attributes in place.

    NB: `engine.paddlex_pipeline` is an `AutoParallelSimpleInferencePipeline` wrapper.
    The real `LayoutParsingPipelineV2` lives in `_pipeline` (single-device) or
    `_pipelines[*]` (multi-device). The wrapper's __getattr__ proxies READ access, but
    setattr on the wrapper does NOT propagate — so `LayoutParsingPipelineV2.predict()`,
    when it calls `self.layout_det_model(...)`, bypasses our wrap. To make hooks actually
    fire, we wrap attributes on each INNER pipeline.

    Idempotent: if an attribute is already a _Hooked wrapper, only the callback is updated.
    Stage names match user-facing labels (layout, text, table, formula,
    region, chart). Missing sub-models are simply skipped (use_*=False).
    """
    pipeline = getattr(engine, "paddlex_pipeline", None)
    if pipeline is None:
        return

    # Find INNER pipelines where sub-models actually live.
    actual_pipelines: list = []
    if getattr(pipeline, "_multi_device_inference", False):
        actual_pipelines = list(getattr(pipeline, "_pipelines", []))
    else:
        inner_pipeline = getattr(pipeline, "_pipeline", None)
        if inner_pipeline is not None:
            actual_pipelines = [inner_pipeline]

    # Fallback for tests that use a MagicMock pipeline without a _pipeline attribute.
    if not actual_pipelines:
        actual_pipelines = [pipeline]

    targets = [
        ("layout_det_model", "layout"),
        ("region_detection_model", "region"),
        ("formula_recognition_pipeline", "formula"),
        ("general_ocr_pipeline", "text"),
        ("table_recognition_pipeline", "table"),
        ("chart_recognition_model", "chart"),
    ]
    for actual in actual_pipelines:
        for attr_name, stage_name in targets:
            if not hasattr(actual, attr_name):
                continue
            inner = getattr(actual, attr_name)
            if isinstance(inner, _Hooked):
                inner.callback = on_stage_start  # update callback (re-install)
                continue
            setattr(actual, attr_name, _Hooked(inner, on_stage_start, stage_name))


def get_engine() -> PPStructureV3:
    """Return (and lazily initialize) the shared PPStructureV3 engine.

    OCR engine language is fixed to 'ru' (cyrillic model). The cyrillic model
    also handles latin characters well — adequate for mixed RU+EN documents
    without splitting into two models. See spec ux-cleanup §2.
    """
    global _engine
    if _engine is None:
        logger.info("Loading PPStructureV3 models (lang=ru, this may take ~30 s)...")
        _engine = PPStructureV3(use_table_recognition=True, lang='ru')
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
    progress_callback=None,
    stage_callback=None,
) -> str:
    """Run OCR on a file and return the result as a markdown string.

    Language is fixed to 'ru' (cyrillic model). The lang parameter was removed — see spec ux-cleanup §2.

    Real progress: for PDFs the file is split into single-page files via PyMuPDF and
    engine.predict() is called per page. progress_callback fires between pages with real values.
    Within a single page, pipeline sub-models run sequentially; stage_callback (if provided)
    fires before each sub-model.

    progress_callback(current_page: int, total_pages: int)
    stage_callback(stage_name: str) — optional
    """
    import tempfile
    engine = get_engine()
    if stage_callback is not None:
        install_stage_hooks(engine, stage_callback)

    path = Path(file_path)
    is_pdf = path.suffix.lower() == ".pdf"

    if not is_pdf:
        # Image: single predict
        if progress_callback is not None:
            progress_callback(1, 1)
        md_parts = [f"# {path.stem}\n"]
        for page_idx, page_result in enumerate(engine.predict(str(file_path))):
            md_parts.append(page_to_markdown(page_result, page_idx + 1))
        if progress_callback is not None:
            progress_callback(1, 1)
        return "\n".join(md_parts)

    # PDF: split per page
    import fitz
    with fitz.open(str(file_path)) as src_pdf:
        total_pages = src_pdf.page_count
        md_parts = [f"# {path.stem}\n"]
        with tempfile.TemporaryDirectory(prefix="ocr_split_") as tmpdir:
            tmp_root = Path(tmpdir)
            for page_idx in range(total_pages):
                page_num = page_idx + 1
                if progress_callback is not None:
                    progress_callback(page_num, total_pages)

                # Extract a single page into a separate PDF
                single_pdf = tmp_root / f"page_{page_num:03d}.pdf"
                with fitz.open() as out_pdf:
                    out_pdf.insert_pdf(src_pdf, from_page=page_idx, to_page=page_idx)
                    out_pdf.save(str(single_pdf))

                # OCR for one page; stage hooks fire inside
                for page_result in engine.predict(str(single_pdf)):
                    md_parts.append(page_to_markdown(page_result, page_num))

                if progress_callback is not None:
                    progress_callback(page_num, total_pages)

    return "\n".join(md_parts)


