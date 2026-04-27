"""
Сбор информации об окружении для status bar.

Редактирование:
- Не делать здесь обращений к БД или к OCR-движку.
- Все источники данных — системные утилиты или переданные параметры.
- Деградация на отсутствии данных — поля становятся None.
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


def get_system_info(
    engine_status: str,
    engine_lang: Optional[str],
    engine_pipeline: list[dict] | None = None,
) -> dict:
    info = _query_nvidia_smi()
    info["engine_status"] = engine_status
    info["engine_lang"] = engine_lang
    info["engine_pipeline"] = engine_pipeline or []
    return info
