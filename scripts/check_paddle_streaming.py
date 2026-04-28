#!/usr/bin/env python3
"""
Smoke test: verify that engine.predict() is a lazy generator, not a batch call.

Purpose / Maintenance notes:
- Run manually; not part of the pytest suite.
- If the generator is truly lazy — print output will show per-page intervals (seconds apart).
- If PaddleOCR batches all pages inside predict() — all lines will appear at once
  after a long pause. In that case the worker progress callback is fake (see risks in spec).
- Do not modify without discussion: this is a reproduction gate, not a feature.
"""
import sys
import time
from pathlib import Path

if len(sys.argv) < 2:
    print("Usage: python3 scripts/check_paddle_streaming.py <test.pdf>")
    sys.exit(1)

pdf = sys.argv[1]
if not Path(pdf).exists():
    print(f"File not found: {pdf}")
    sys.exit(1)

# Import only after validating arguments — avoids the ~30 s model-loading
# cost on simple usage errors.
from paddleocr import PPStructureV3

print("Loading PPStructureV3 (lang=ru)...")
t_load = time.time()
engine = PPStructureV3(use_table_recognition=True, lang='ru')
print(f"Engine ready in {time.time() - t_load:.1f}s")

print(f"\nStarting predict() on {pdf}")
t0 = time.time()
for i, page in enumerate(engine.predict(pdf), start=1):
    elapsed = time.time() - t0
    print(f"  Page {i} yielded at +{elapsed:.2f}s")

total = time.time() - t0
print(f"\nTotal predict() time: {total:.1f}s")
print("\nInterpretation:")
print("  - If 'yielded at' times grow linearly → generator IS lazy, real progress works.")
print("  - If all yields cluster at the end → PaddleOCR batches internally,")
print("    worker progress is fake (UI sees jump from 0% to 100%).")
