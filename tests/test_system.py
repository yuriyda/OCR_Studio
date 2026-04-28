"""Tests for app/system.py."""
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


def test_recommend_hq_mode_no_gpu():
    from app.system import recommend_hq_mode
    rec = recommend_hq_mode(vram_gb=None, gpu_present=False)
    assert rec["hq_mode"] == "off"
    assert "GPU not detected" in rec["reason"]


def test_recommend_hq_mode_low_vram():
    from app.system import recommend_hq_mode
    rec = recommend_hq_mode(vram_gb=3, gpu_present=True)
    assert rec["hq_mode"] == "off"
    assert rec["warning"] is not None
    assert "will not fit" in rec["warning"]


def test_recommend_hq_mode_borderline_vram():
    from app.system import recommend_hq_mode
    rec = recommend_hq_mode(vram_gb=5, gpu_present=True)
    assert rec["hq_mode"] == "off"
    assert "risky" in (rec["warning"] or "").lower()


def test_recommend_hq_mode_medium_vram():
    from app.system import recommend_hq_mode
    rec = recommend_hq_mode(vram_gb=7, gpu_present=True)
    assert rec["hq_mode"] == "off"
    assert rec["warning"] is None  # 6-8 GB: off, but no warning


def test_recommend_hq_mode_high_vram():
    from app.system import recommend_hq_mode
    rec = recommend_hq_mode(vram_gb=10, gpu_present=True)
    assert rec["hq_mode"] == "on"
    assert rec["warning"] is None


def test_recommend_hq_mode_very_high_vram():
    from app.system import recommend_hq_mode
    rec = recommend_hq_mode(vram_gb=16, gpu_present=True)
    assert rec["hq_mode"] == "on"
    assert "smooth" in rec["reason"].lower()


def test_get_system_info_includes_recommendation():
    from app.system import get_system_info
    info = get_system_info(engine_status="ready", engine_lang="ru")
    assert "recommendation" in info
    assert info["recommendation"]["hq_mode"] in ("on", "off")
