"""
Unit-тесты для app/ocr_engine.py.

Редактирование:
- Тесты покрывают поведение progress_callback в process_file.
- Моки используются для изоляции от PaddleOCR и fitz.
- Не удалять существующие тесты без согласования.
- Lang-параметр удалён из process_file (ux-cleanup §2) — тесты не передают lang.
- ВАЖНО: импорт ocr_engine выполняется внутри каждого теста, а не на уровне модуля.
  Это необходимо, потому что другие тесты (test_api.py) сбрасывают sys.modules["app.*"]
  и переимпортируют модули заново; верхнеуровневая ссылка оказалась бы устаревшей.
"""
import sys
from unittest.mock import MagicMock, patch


def _get_ocr_engine_module():
    """Возвращает актуальный модуль app.ocr_engine из sys.modules."""
    import importlib
    return importlib.import_module("app.ocr_engine")


def test_process_file_calls_progress_callback_per_page(tmp_path):
    """Callback вызывается с (current_page, total_pages) для каждой страницы."""
    fake_pdf = tmp_path / "x.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4 stub")

    fake_doc = MagicMock()
    fake_doc.page_count = 3
    fake_doc.__enter__ = MagicMock(return_value=fake_doc)
    fake_doc.__exit__ = MagicMock(return_value=False)

    fake_pages = [MagicMock(json={"res": {"parsing_res_list": [], "table_res_list": []}}) for _ in range(3)]
    fake_engine = MagicMock()
    fake_engine.predict = MagicMock(return_value=iter(fake_pages))

    callback_calls = []

    ocr_engine = _get_ocr_engine_module()
    with patch.object(ocr_engine, "get_engine", return_value=fake_engine), \
         patch("fitz.open", return_value=fake_doc):
        ocr_engine.process_file(
            str(fake_pdf),
            progress_callback=lambda cur, total: callback_calls.append((cur, total)),
        )

    # Callback fires 2x per page (start + end) — see Task 7.
    assert callback_calls == [(1, 3), (1, 3), (2, 3), (2, 3), (3, 3), (3, 3)]


def test_process_file_works_without_callback(tmp_path):
    """Без callback не падает (обратная совместимость)."""
    fake_pdf = tmp_path / "x.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4 stub")

    fake_doc = MagicMock()
    fake_doc.page_count = 1
    fake_doc.__enter__ = MagicMock(return_value=fake_doc)
    fake_doc.__exit__ = MagicMock(return_value=False)

    fake_pages = [MagicMock(json={"res": {"parsing_res_list": [], "table_res_list": []}})]
    fake_engine = MagicMock()
    fake_engine.predict = MagicMock(return_value=iter(fake_pages))

    ocr_engine = _get_ocr_engine_module()
    with patch.object(ocr_engine, "get_engine", return_value=fake_engine), \
         patch("fitz.open", return_value=fake_doc):
        result = ocr_engine.process_file(str(fake_pdf))

    assert isinstance(result, str)


def test_process_file_image_callback_single_page(tmp_path):
    """Для картинки — один вызов callback (1, 1)."""
    fake_img = tmp_path / "x.png"
    fake_img.write_bytes(b"\x89PNG stub")

    fake_pages = [MagicMock(json={"res": {"parsing_res_list": [], "table_res_list": []}})]
    fake_engine = MagicMock()
    fake_engine.predict = MagicMock(return_value=iter(fake_pages))

    callback_calls = []

    ocr_engine = _get_ocr_engine_module()
    with patch.object(ocr_engine, "get_engine", return_value=fake_engine):
        ocr_engine.process_file(
            str(fake_img),
            progress_callback=lambda cur, total: callback_calls.append((cur, total)),
        )

    # Callback fires 2x per page (start + end) — see Task 7.
    assert callback_calls == [(1, 1), (1, 1)]


def test_progress_callback_called_at_start_and_end_of_each_page(monkeypatch, tmp_path):
    """Callback должен вызываться 2 раза на страницу: до и после обработки.

    После рефакторинга process_file: PDF-страницы обрабатываются per-page через
    реальный split (fitz). Для image-файлов — callback вызывается 2 раза (1, 1).
    Этот тест проверяет image path: 2 вызова (start + end).
    """
    import fitz
    from unittest.mock import MagicMock, patch
    from app import ocr_engine

    # Build 3-page PDF for multi-page callback test
    pdf_path = tmp_path / "test.pdf"
    pdf = fitz.open()
    for i in range(3):
        pdf.new_page(width=200, height=200)
    pdf.save(str(pdf_path))
    pdf.close()

    fake_page = MagicMock()
    fake_page.json = {"res": {"parsing_res_list": [], "table_res_list": []}}
    fake_engine = MagicMock()
    fake_engine.predict = lambda f: iter([fake_page])
    fake_engine.paddlex_pipeline = MagicMock()

    calls = []
    with patch.object(ocr_engine, "get_engine", return_value=fake_engine):
        ocr_engine.process_file(
            str(pdf_path),
            progress_callback=lambda c, t: calls.append((c, t)),
        )
    # 2 вызова на страницу × 3 страницы = 6 минимум.
    assert len(calls) >= 6, f"expected >=6 callback calls, got {len(calls)}: {calls}"
    # Первый вызов — start of page 1.
    assert calls[0][0] == 1
    # Последний вызов — end of last page.
    assert calls[-1][0] == 3


def test_install_stage_hooks_calls_callback_when_submodel_invoked(monkeypatch):
    """install_stage_hooks wraps engine sub-models so callback fires before each call."""
    from unittest.mock import MagicMock
    from app import ocr_engine

    fake_layout = MagicMock(return_value="layout-output")
    fake_ocr = MagicMock(return_value="ocr-output")
    fake_pipeline = MagicMock()
    fake_pipeline.layout_det_model = fake_layout
    fake_pipeline.general_ocr_pipeline = fake_ocr

    fake_engine = MagicMock()
    fake_engine.paddlex_pipeline = fake_pipeline

    stages_seen = []
    ocr_engine.install_stage_hooks(fake_engine, lambda name: stages_seen.append(name))

    fake_engine.paddlex_pipeline.layout_det_model("img")
    fake_engine.paddlex_pipeline.general_ocr_pipeline("img")
    fake_engine.paddlex_pipeline.layout_det_model("img2")

    assert stages_seen == ["layout", "text", "layout"]


def test_process_file_pdf_splits_per_page_and_calls_progress(monkeypatch, tmp_path):
    """For PDFs, process_file splits into per-page predict() calls — real per-page progress."""
    import fitz
    from unittest.mock import MagicMock, patch
    from app import ocr_engine

    # Build 3-page PDF
    pdf_path = tmp_path / "x.pdf"
    pdf = fitz.open()
    for i in range(3):
        pdf.new_page(width=200, height=200)
    pdf.save(str(pdf_path))
    pdf.close()

    predict_calls = []
    fake_engine = MagicMock()
    def fake_predict(file_path):
        predict_calls.append(file_path)
        page = MagicMock()
        page.json = {"res": {"parsing_res_list": [
            {"block_label": "text", "block_content": "x", "block_bbox": [0, 0, 100, 100]}
        ], "table_res_list": []}}
        return iter([page])
    fake_engine.predict = fake_predict
    fake_engine.paddlex_pipeline = MagicMock()  # no real sub-models

    callback_calls = []
    with patch.object(ocr_engine, "get_engine", return_value=fake_engine):
        ocr_engine.process_file(
            str(pdf_path),
            progress_callback=lambda cur, total: callback_calls.append((cur, total)),
        )

    # Each page → separate predict call (per-page split)
    assert len(predict_calls) == 3, f"expected 3 predict calls, got {len(predict_calls)}"
    # Progress callback fires per page (start + end), so 6 total for 3 pages
    pages_seen = sorted(set(c[0] for c in callback_calls))
    assert pages_seen == [1, 2, 3]


def test_process_file_image_single_predict(monkeypatch, tmp_path):
    """For images, process_file calls predict once (no split)."""
    from PIL import Image
    from unittest.mock import MagicMock, patch
    from app import ocr_engine

    img = tmp_path / "x.png"
    Image.new("RGB", (100, 100), "white").save(str(img))

    predict_calls = []
    fake_engine = MagicMock()
    def fake_predict(file_path):
        predict_calls.append(file_path)
        page = MagicMock()
        page.json = {"res": {"parsing_res_list": [], "table_res_list": []}}
        return iter([page])
    fake_engine.predict = fake_predict
    fake_engine.paddlex_pipeline = MagicMock()

    with patch.object(ocr_engine, "get_engine", return_value=fake_engine):
        ocr_engine.process_file(str(img))
    assert len(predict_calls) == 1


def test_process_file_iterates_generator_lazily(monkeypatch, tmp_path):
    """process_file должен итерировать engine.predict() как ленивый generator,
    не материализуя через list() — иначе progress_callback фейковый.
    """
    import importlib
    from unittest.mock import MagicMock, patch
    from app import ocr_engine

    # Build a 3-page mock generator
    fake_pages = []
    for i in range(3):
        page = MagicMock()
        page.json = {"res": {"parsing_res_list": [
            {"block_label": "text", "block_content": f"page {i+1}", "block_bbox": [0, 0, 100, 100]}
        ], "table_res_list": []}}
        fake_pages.append(page)

    pull_count = [0]
    def gen():
        for p in fake_pages:
            pull_count[0] += 1
            yield p

    fake_engine = MagicMock()
    fake_engine.predict.return_value = gen()

    img = tmp_path / "x.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")

    callback_calls = []
    def cb(cur, total):
        callback_calls.append((cur, total, pull_count[0]))

    with patch.object(ocr_engine, "get_engine", return_value=fake_engine):
        ocr_engine.process_file(str(img), progress_callback=cb)

    assert callback_calls, "no callback fired"
    first_pull_count_at_callback = callback_calls[0][2]
    assert first_pull_count_at_callback < 3, (
        f"callback fired only after generator was fully consumed "
        f"(pulls={first_pull_count_at_callback}); progress is fake"
    )


