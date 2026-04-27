"""
Обёртка над PaddleOCR PPStructureV3.

Редактирование:
- Язык OCR-движка зафиксирован = 'ru' (cyrillic-модель). Не добавлять lang-параметр
  обратно без согласования — см. spec ux-cleanup §2.
- Public-API: `process_file(file_path, progress_callback=None, stage_callback=None)`.
  Его вызывает worker в app/main.py.
- Фикс порядка колонок таблиц через сортировку по X-координате (`html_table_to_markdown`)
  не удалять — он чинит баг SLANet (см. memory.md «Table Column Order Fix»).
- progress_callback вызывается в начале и конце обработки каждой страницы (1-based).
- stage_callback вызывается перед вызовом каждой sub-model pipeline (layout/text/table/formula).
- PDF разбивается на single-page файлы через PyMuPDF — predict() вызывается per-page.
  Это даёт реальный прогресс за счёт потери batch-оптимизаций PaddleOCR (~30-50% slower).
"""

import logging
from pathlib import Path

from bs4 import BeautifulSoup
from paddleocr import PPStructureV3

logger = logging.getLogger(__name__)

_engine: PPStructureV3 | None = None

# Список ключевых моделей PPStructureV3 pipeline. Используется в /api/system и
# stage_label («Загрузка моделей: ...»). Имена соответствуют каталогам в
# /home/node/.paddlex/official_models/. Меняется только при апгрейде PaddleOCR.
PIPELINE_MODELS: list[dict] = [
    {"role": "layout",   "name": "PicoDet-S_layout_3cls"},
    {"role": "text_det", "name": "PP-OCRv5_server_det"},
    {"role": "text_rec", "name": "cyrillic_PP-OCRv3"},
    {"role": "table",    "name": "SLANet_plus + RT-DETR-L_wired_table_cell_det"},
    {"role": "formula",  "name": "PP-FormulaNet_plus-L"},
]


class _Hooked:
    """Callable proxy that fires callback(name) before delegating to inner.

    Используется install_stage_hooks для оборачивания sub-model атрибутов
    paddlex_pipeline. Ошибки callback изолированы — не ломают OCR-процесс.
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
    """Wrap sub-models on engine.paddlex_pipeline so on_stage_start(name) fires
    before each model invocation. Side-effect: replaces attributes in place.

    Идемпотентно: если атрибут — наша обёртка _Hooked, не оборачиваем повторно.
    Названия stage соответствуют user-facing labels: layout, text, table, formula,
    region, chart. Sub-model отсутствует (опциональный pipeline) — просто пропускаем.
    """
    pipeline = getattr(engine, "paddlex_pipeline", None)
    if pipeline is None:
        return

    targets = [
        ("layout_det_model", "layout"),
        ("region_detection_model", "region"),
        ("formula_recognition_pipeline", "formula"),
        ("general_ocr_pipeline", "text"),
        ("table_recognition_pipeline", "table"),
        ("chart_recognition_model", "chart"),
    ]
    for attr_name, stage_name in targets:
        if not hasattr(pipeline, attr_name):
            continue
        inner = getattr(pipeline, attr_name)
        if isinstance(inner, _Hooked):
            inner.callback = on_stage_start  # update callback (re-install)
            continue
        setattr(pipeline, attr_name, _Hooked(inner, on_stage_start, stage_name))


def get_engine() -> PPStructureV3:
    """Return (and lazily initialize) the shared PPStructureV3 engine.

    Язык OCR-движка зафиксирован = 'ru' (cyrillic-модель). Cyrillic-модель
    хорошо захватывает и латиницу — для смешанных RU+EN документов работает
    приемлемо без разделения на 2 модели. См. spec ux-cleanup §2.
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

    Язык зафиксирован = 'ru' (cyrillic-модель). Lang-параметр удалён — см. spec ux-cleanup §2.

    Real progress: для PDF разбиваем на single-page файлы через PyMuPDF и
    вызываем engine.predict() per-page. progress_callback срабатывает между
    страницами с реальными значениями. Внутри одной страницы — sub-models
    pipeline'а вызываются последовательно; stage_callback (если задан)
    срабатывает перед каждой sub-model.

    progress_callback(current_page: int, total_pages: int)
    stage_callback(stage_name: str) — необязательный
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

                # Извлекаем одну страницу в отдельный PDF
                single_pdf = tmp_root / f"page_{page_num:03d}.pdf"
                with fitz.open() as out_pdf:
                    out_pdf.insert_pdf(src_pdf, from_page=page_idx, to_page=page_idx)
                    out_pdf.save(str(single_pdf))

                # OCR одной страницы; stage hooks fire внутри
                for page_result in engine.predict(str(single_pdf)):
                    md_parts.append(page_to_markdown(page_result, page_num))

                if progress_callback is not None:
                    progress_callback(page_num, total_pages)

    return "\n".join(md_parts)


