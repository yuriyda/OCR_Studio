"""Unit tests for app.limits — env-driven max source file size."""
from app import limits


def test_default_is_50_mb(monkeypatch):
    monkeypatch.delenv("OCR_MAX_FILE_MB", raising=False)
    assert limits._max_file_size_from_env() == 50 * 1024 * 1024


def test_env_override(monkeypatch):
    monkeypatch.setenv("OCR_MAX_FILE_MB", "200")
    assert limits._max_file_size_from_env() == 200 * 1024 * 1024


def test_invalid_values_fall_back_to_default(monkeypatch):
    for bad in ("abc", "-5", "0", "12.5"):
        monkeypatch.setenv("OCR_MAX_FILE_MB", bad)
        assert limits._max_file_size_from_env() == 50 * 1024 * 1024
