"""Shared source-file limits for the upload API (app.main) and the watcher.

A single module so the two entry points cannot drift apart (they used to
duplicate the constant). The value is resolved once at import time from the
OCR_MAX_FILE_MB environment variable; a missing or invalid value falls back
to the 50 MB default.
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

_DEFAULT_MAX_FILE_MB = 50


def _max_file_size_from_env() -> int:
    raw = os.environ.get("OCR_MAX_FILE_MB", "")
    if raw:
        try:
            mb = int(raw)
            if mb > 0:
                return mb * 1024 * 1024
        except ValueError:
            pass
        logger.warning(
            "OCR_MAX_FILE_MB=%r is not a positive integer; using default %d MB",
            raw, _DEFAULT_MAX_FILE_MB,
        )
    return _DEFAULT_MAX_FILE_MB * 1024 * 1024


MAX_FILE_SIZE = _max_file_size_from_env()
MAX_FILE_SIZE_MB = MAX_FILE_SIZE // (1024 * 1024)
