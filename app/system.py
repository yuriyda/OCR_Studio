"""
Environment information collection for the status bar.

Maintenance notes:
- No database or OCR-engine access here.
- All data sources are system utilities or passed-in parameters.
- Graceful degradation on missing data — fields become None.
"""
from __future__ import annotations

import subprocess
from typing import Optional


def _parse_nvidia_smi(line: str) -> dict:
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 3:
        return {"gpu": None, "cuda": None, "vram_gb": None}
    return {
        "gpu": parts[0],
        "cuda": parts[1],
        "vram_gb": int(round(int(parts[2]) / 1024)),
    }


def _query_nvidia_smi() -> dict:
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,driver_version,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
        first = out.stdout.strip().splitlines()[0]
        return _parse_nvidia_smi(first)
    except (FileNotFoundError, subprocess.SubprocessError, IndexError, ValueError):
        return {"gpu": None, "cuda": None, "vram_gb": None}


def recommend_hq_mode(vram_gb: int | None, gpu_present: bool) -> dict:
    """Suggest HQ-mode default based on detected GPU VRAM.

    Thresholds (from spec §architecture):
      - GPU absent: off, "GPU not detected"
      - <4 GB:      off, won't fit
      - 4-6 GB:     off, risky
      - 6-8 GB:     off, no warning, hint allowed
      - 8-12 GB:    on, "should work reliably"
      - >12 GB:     on, "smooth sailing"
    """
    if not gpu_present or vram_gb is None:
        return {
            "hq_mode": "off",
            "reason": "GPU not detected; HQ-mode would be very slow on CPU.",
            "warning": None,
        }
    if vram_gb < 4:
        return {
            "hq_mode": "off",
            "reason": f"GPU has {vram_gb} GB VRAM.",
            "warning": "HQ-mode requires ~5 GB and will not fit on this GPU.",
        }
    if vram_gb < 6:
        return {
            "hq_mode": "off",
            "reason": f"GPU has {vram_gb} GB VRAM.",
            "warning": "HQ-mode is risky on this GPU — may OOM on large documents.",
        }
    if vram_gb < 8:
        return {
            "hq_mode": "off",
            "reason": f"GPU has {vram_gb} GB VRAM. You can try HQ; heavy PDFs may fail.",
            "warning": None,
        }
    if vram_gb < 12:
        return {
            "hq_mode": "on",
            "reason": f"GPU has {vram_gb} GB VRAM — should work reliably.",
            "warning": None,
        }
    return {
        "hq_mode": "on",
        "reason": f"GPU has {vram_gb} GB VRAM — smooth sailing for all 5 sub-models.",
        "warning": None,
    }


def get_system_info(
    engine_status: str,
    engine_lang: Optional[str],
    engine_pipeline: list[dict] | None = None,
) -> dict:
    info = _query_nvidia_smi()
    info["engine_status"] = engine_status
    info["engine_lang"] = engine_lang
    info["engine_pipeline"] = engine_pipeline or []
    info["recommendation"] = recommend_hq_mode(
        vram_gb=info.get("vram_gb"),
        gpu_present=info.get("gpu") is not None,
    )
    return info
