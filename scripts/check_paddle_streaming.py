#!/usr/bin/env python3
"""
Smoke-test: убедиться, что engine.predict() — ленивый generator, а не batch.

Назначение / редактирование:
- Запускать вручную, не часть pytest suite.
- Если generator реально lazy — print покажет постраничные интервалы (секунды).
- Если PaddleOCR батчит все страницы внутри predict() — все строки появятся
  одновременно после длительной паузы. В таком случае worker progress
  callback фейковый (см. risks в spec).
- Не модифицировать без согласования: это репродукционный гейт, не функциональность.
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

# Import только если файл валиден — избегаем 30s загрузки моделей
# при синтаксических ошибках вызова.
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
