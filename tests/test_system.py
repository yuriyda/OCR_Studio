"""Тесты для app/system.py."""
from unittest.mock import patch
from app import system


def test_get_system_info_no_gpu():
    with patch("subprocess.run", side_effect=FileNotFoundError):
        info = system.get_system_info(engine_status="ready", engine_lang="ru")
    assert info["gpu"] is None
    assert info["cuda"] is None
    assert info["vram_gb"] is None
    assert info["engine_status"] == "ready"
    assert info["engine_lang"] == "ru"


def test_parse_nvidia_smi_output():
    sample = "NVIDIA GeForce RTX 4090, 591.44, 16384"
    parsed = system._parse_nvidia_smi(sample)
    assert parsed["gpu"] == "NVIDIA GeForce RTX 4090"
    assert parsed["cuda"] == "591.44"
    assert parsed["vram_gb"] == 16
