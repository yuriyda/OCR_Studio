"""
Shared pytest fixtures for backend tests.
Maintenance notes: add fixtures; do not remove existing ones without discussion.
"""
import shutil
import sys
import tempfile
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest


def stub_paddleocr_modules():
    """Install stubs for paddleocr and paddlepaddle, which are not present in the test environment.

    Must be called before any import of app.ocr_engine to avoid ModuleNotFoundError.
    """
    for mod_name in ("paddleocr", "paddle", "paddlepaddle"):
        if mod_name not in sys.modules:
            sys.modules[mod_name] = types.ModuleType(mod_name)
    paddle_mod = sys.modules["paddleocr"]
    paddle_mod.PPStructureV3 = MagicMock()


# Install stubs immediately on conftest load to guarantee correct environment
# for all test files regardless of execution order.
stub_paddleocr_modules()


@pytest.fixture
def tmp_data_dir(monkeypatch):
    """Isolated data/ directory for each test."""
    tmp = Path(tempfile.mkdtemp(prefix="ocr_test_"))
    (tmp / "docs").mkdir()
    monkeypatch.setenv("OCR_DATA_DIR", str(tmp))
    yield tmp
    shutil.rmtree(tmp, ignore_errors=True)
