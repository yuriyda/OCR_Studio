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
    # Base set — always loaded
    {"role": "layout",   "name": "PicoDet-S_layout_3cls"},
    {"role": "text_det", "name": "PP-OCRv5_server_det"},
    {"role": "text_rec", "name": "cyrillic_PP-OCRv3"},
    {"role": "table",    "name": "SLANet_plus + RT-DETR-L_wired_table_cell_det"},
    {"role": "formula",  "name": "PP-FormulaNet_plus-L"},
    # Optional set — gated by HQ-mode flags in app/settings.py
    {"role": "orientation", "name": "PP-LCNet_x1_0_doc_ori",      "optional": True},
    {"role": "unwarping",   "name": "UVDoc",                       "optional": True},
    {"role": "textline",    "name": "PP-LCNet_x1_0_textline_ori",  "optional": True},
    {"role": "chart",       "name": "PP-Chart2Table",              "optional": True},
    {"role": "seal",        "name": "PP-OCRv4_seal_det",           "optional": True},
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
        ("doc_orientation_classify_model", "orientation"),
        ("doc_unwarping_model", "unwarping"),
        ("textline_orientation_model", "textline"),
        ("seal_recognition_pipeline", "seal"),
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


def get_engine(db_path: Path | None = None) -> "PPStructureV3":
    """Return (and lazily initialize) the shared PPStructureV3 engine.

    OCR engine language is fixed to 'ru' (cyrillic model). The cyrillic model
    also handles latin characters well — adequate for mixed RU+EN documents.
    See spec ux-cleanup §2.

    HQ-mode flags are read from SettingsRepo on each cold start. Runtime changes
    require reload_engine_async().
    """
    global _engine
    if _engine is None:
        from . import db, settings as settings_mod
        cfg: dict[str, bool] = {k: False for k in settings_mod.HQ_KEYS}
        if db_path is not None:
            conn = db.get_connection(db_path)
            try:
                cfg = settings_mod.SettingsRepo(conn).get_hq_config()
            finally:
                conn.close()
        logger.info(
            "Loading PPStructureV3 (lang=ru, HQ flags: orientation=%s unwarp=%s "
            "textline=%s chart=%s seal=%s)...",
            cfg["hq_orientation"], cfg["hq_unwarping"], cfg["hq_textline"],
            cfg["hq_chart"], cfg["hq_seal"],
        )
        _engine = PPStructureV3(
            use_table_recognition=True,
            use_doc_orientation_classify=cfg["hq_orientation"],
            use_doc_unwarping=cfg["hq_unwarping"],
            use_textline_orientation=cfg["hq_textline"],
            use_chart_recognition=cfg["hq_chart"],
            use_seal_recognition=cfg["hq_seal"],
            lang='ru',
        )
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


class _ProgressLogHandler(logging.Handler):
    """Logging handler that parses 'loading <model_name>' lines into progress events.

    Attached to the 'paddleocr' and 'paddlex' loggers for the duration of
    PPStructureV3(...) construction inside reload_engine_async. Models from
    expected_models that have been already announced are deduplicated via the
    `loaded` set.
    """

    def __init__(self, expected_models: list[str], on_progress) -> None:
        super().__init__()
        self.expected = expected_models
        self.loaded: set[str] = set()
        self.on_progress = on_progress

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = record.getMessage()
        except Exception:
            return
        for model in self.expected:
            if model in msg and model not in self.loaded:
                self.loaded.add(model)
                try:
                    self.on_progress(
                        loaded=len(self.loaded),
                        total=len(self.expected),
                        current=model,
                    )
                except Exception:
                    pass  # callback errors must not break OCR setup
                break


def _expected_models_for_config(cfg: dict[str, bool]) -> list[str]:
    """Return the list of model names expected to load given the HQ config."""
    base = [m["name"] for m in PIPELINE_MODELS if not m.get("optional")]
    optional_role_to_flag = {
        "orientation": "hq_orientation",
        "unwarping": "hq_unwarping",
        "textline": "hq_textline",
        "chart": "hq_chart",
        "seal": "hq_seal",
    }
    optional = [
        m["name"] for m in PIPELINE_MODELS
        if m.get("optional") and cfg.get(optional_role_to_flag.get(m["role"], ""), False)
    ]
    return base + optional


async def reload_engine_async(db_path, on_progress, on_done, on_error) -> None:
    """Destroy the current engine and rebuild it under the current settings.

    Streams per-model progress via on_progress(loaded, total, current). Calls
    on_done() once the new engine is ready, or on_error(exc) and falls back to
    a basic-mode engine on construction failure.

    Hooks the PaddleOCR loggers ('paddleocr' and 'paddlex') with _ProgressLogHandler
    for the duration of construction; handlers are removed in finally.
    Logger levels are saved before attachment and restored in finally to avoid
    permanent level mutation.
    """
    global _engine
    import asyncio
    from . import db, settings as settings_mod

    conn = db.get_connection(db_path)
    try:
        cfg = settings_mod.SettingsRepo(conn).get_hq_config()
    finally:
        conn.close()

    expected = _expected_models_for_config(cfg)
    handler = _ProgressLogHandler(expected, on_progress)

    target_loggers = [logging.getLogger("paddleocr"), logging.getLogger("paddlex")]
    # Save levels before mutating so they can be restored in finally.
    prev_levels = [(lg, lg.level) for lg in target_loggers]
    for lg in target_loggers:
        lg.addHandler(handler)
        lg.setLevel(logging.INFO)

    def build():
        global _engine
        _engine = None  # release VRAM via GC
        _engine = PPStructureV3(
            use_table_recognition=True,
            use_doc_orientation_classify=cfg["hq_orientation"],
            use_doc_unwarping=cfg["hq_unwarping"],
            use_textline_orientation=cfg["hq_textline"],
            use_chart_recognition=cfg["hq_chart"],
            use_seal_recognition=cfg["hq_seal"],
            lang='ru',
        )

    try:
        await asyncio.to_thread(build)
    except Exception as exc:
        logger.exception("Engine reload failed; falling back to basic mode")
        try:
            on_error(exc)
        except Exception:
            pass
        # Fallback: rebuild with basic config and revert settings to basic
        try:
            conn2 = db.get_connection(db_path)
            try:
                settings_mod.SettingsRepo(conn2).set_hq_config(
                    {k: False for k in settings_mod.HQ_KEYS}
                )
            finally:
                conn2.close()

            def build_basic():
                global _engine
                _engine = None
                _engine = PPStructureV3(use_table_recognition=True, lang='ru')

            await asyncio.to_thread(build_basic)
        except Exception:
            logger.exception("Basic-mode fallback also failed; engine remains None")
            _engine = None
    else:
        # on_done is called only when build() succeeded. Errors from on_done
        # (e.g. broken SSE socket) must NOT trigger the basic-mode fallback —
        # the engine itself is fine.
        try:
            on_done()
        except Exception:
            logger.exception("on_done callback raised; engine still loaded")
    finally:
        for lg in target_loggers:
            lg.removeHandler(handler)
        # Restore logger levels to prevent permanent level mutation across reloads.
        for lg, lvl in prev_levels:
            lg.setLevel(lvl)


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


