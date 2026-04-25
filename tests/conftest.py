"""
Общие pytest-фикстуры для backend-тестов.
Редактирование: добавлять фикстуры, не удалять существующие без согласования.
"""
import shutil
import sys
import tempfile
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest


def stub_paddleocr_modules():
    """Подставляет заглушки для paddleocr и paddlepaddle, которых нет в тестовой среде.

    Вызывается до любого импорта app.ocr_engine, чтобы избежать ModuleNotFoundError.
    """
    for mod_name in ("paddleocr", "paddle", "paddlepaddle"):
        if mod_name not in sys.modules:
            sys.modules[mod_name] = types.ModuleType(mod_name)
    paddle_mod = sys.modules["paddleocr"]
    paddle_mod.PPStructureV3 = MagicMock()


# Вызываем заглушки сразу при загрузке conftest, чтобы гарантировать корректное окружение
# для всех тестовых файлов независимо от порядка их выполнения.
stub_paddleocr_modules()


@pytest.fixture
def tmp_data_dir(monkeypatch):
    """Изолированная папка data/ для каждого теста."""
    tmp = Path(tempfile.mkdtemp(prefix="ocr_test_"))
    (tmp / "docs").mkdir()
    monkeypatch.setenv("OCR_DATA_DIR", str(tmp))
    yield tmp
    shutil.rmtree(tmp, ignore_errors=True)
