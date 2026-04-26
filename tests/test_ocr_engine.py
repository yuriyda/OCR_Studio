"""
Unit-тесты для app/ocr_engine.py.

Редактирование:
- Тесты покрывают поведение progress_callback в process_file.
- Моки используются для изоляции от PaddleOCR и fitz.
- Не удалять существующие тесты без согласования.
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
            lang="ru",
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
        result = ocr_engine.process_file(str(fake_pdf), lang="ru")

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
            lang="ru",
            progress_callback=lambda cur, total: callback_calls.append((cur, total)),
        )

    # Callback fires 2x per page (start + end) — see Task 7.
    assert callback_calls == [(1, 1), (1, 1)]


def test_progress_callback_called_at_start_and_end_of_each_page(monkeypatch, tmp_path):
    """Callback должен вызываться 2 раза на страницу: до и после обработки."""
    from unittest.mock import MagicMock
    from app import ocr_engine

    fake_page = MagicMock()
    fake_page.json = {"res": {"parsing_res_list": [], "table_res_list": []}}
    fake_engine = MagicMock()
    fake_engine.predict.return_value = [fake_page, fake_page, fake_page]  # 3 страницы

    monkeypatch.setattr(ocr_engine, "_engine", fake_engine, raising=False)
    monkeypatch.setattr(ocr_engine, "_engine_lang", "ru", raising=False)

    img_path = tmp_path / "fake.jpg"
    img_path.write_bytes(b"x")

    calls = []
    ocr_engine.process_file(
        str(img_path),
        lang="ru",
        progress_callback=lambda c, t: calls.append((c, t)),
    )
    # Минимум 2 вызова на страницу × 3 страницы = 6.
    assert len(calls) >= 6, f"expected >=6 callback calls, got {len(calls)}: {calls}"
    # Первый вызов — start of page 1.
    assert calls[0][0] == 1
    # Последний вызов — end of last page.
    assert calls[-1][0] == 3


def test_preload_initializes_engine_for_lang(monkeypatch):
    """preload(lang) должен вызывать get_engine(lang) и не падать."""
    from app import ocr_engine
    monkeypatch.setattr(ocr_engine, "_engine", None, raising=False)
    monkeypatch.setattr(ocr_engine, "_engine_lang", "ru", raising=False)
    monkeypatch.setattr(ocr_engine, "PPStructureV3", lambda **kw: object())

    eng = ocr_engine.preload("en")
    assert eng is not None
    assert ocr_engine._engine_lang == "en"
