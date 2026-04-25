"""
Общие pytest-фикстуры для backend-тестов.
Редактирование: добавлять фикстуры, не удалять существующие без согласования.
"""
import os
import shutil
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def tmp_data_dir(monkeypatch):
    """Изолированная папка data/ для каждого теста."""
    tmp = Path(tempfile.mkdtemp(prefix="ocr_test_"))
    (tmp / "docs").mkdir()
    monkeypatch.setenv("OCR_DATA_DIR", str(tmp))
    yield tmp
    shutil.rmtree(tmp, ignore_errors=True)
