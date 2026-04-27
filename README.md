[English](README.md) | [Русский](README.ru.md)

# OCR Studio

Self-hosted document OCR web service powered by PaddleOCR PPStructureV3 — projects, drag-and-drop, real per-page progress, lossless markdown / DOCX export.

![OCR Studio UI](screenshot.png)

## Features

- Recognize PDF + images (PNG, JPG, BMP, TIFF, WEBP) with **tables**, **formulas**, **layout structure**
- Organize documents into projects (CRUD, drag-and-drop between projects, batch ZIP download)
- **Real per-page + per-stage OCR progress** ("page 5/38: text recognition") — not faked
- 3-pane UI with resizable splitters: project sidebar, source preview (PDF/image), result preview
- Output formats: **Markdown** (canonical), **TXT**, **DOCX** with formatting (lists, bold/italic, code, tables)
- Disk-cached PDF preview (low-DPI thumbs all-at-once + lazy full-page on click)
- Bilingual UI (RU/EN) with hot-swap
- SQLite + filesystem persistence with crash recovery

## Models pipeline

OCR Studio uses **PaddleOCR PPStructureV3** for document understanding. The pipeline runs 6 stages per page:

```
PDF/Image
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│ 1. Layout Detection         PicoDet-S_layout_3cls                │
│    Identifies blocks (text / table / formula / image / chart)    │
│                                                                    │
│ 2. Region Detection         PP-DocBlockLayout                    │
│    Optional secondary structural pass                            │
│                                                                    │
│ 3. Formula Recognition      PP-FormulaNet_plus-L                 │
│    LaTeX extraction from math regions                            │
│                                                                    │
│ 4. Text Recognition         PP-OCRv5_server_det                  │
│                              + eslav_PP-OCRv5_mobile_rec          │
│    Detects text lines, then recognizes (cyrillic + latin model). │
│                                                                    │
│ 5. Table Recognition        SLANet_plus + RT-DETR-L              │
│                              _wired_table_cell_det               │
│    HTML table reconstruction with cell-bbox detection.           │
│                                                                    │
│ 6. Chart Recognition        (optional, not enabled by default)   │
└──────────────────────────────────────────────────────────────────┘
```

`lang=ru` selects the cyrillic recognition model (`eslav_PP-OCRv5_mobile_rec`) which handles mixed Cyrillic + Latin documents acceptably.

SLANet table column-order fix (cell sort by X-coordinate) is applied in `app/ocr_engine.py:html_table_to_markdown` to work around arbitrary token ordering from the seq2seq table model.

## Key technical decisions

### 4.1. Real per-page OCR progress (not fake)

**Problem**: `engine.predict(file)` is NOT a lazy generator — internally batches all pages, yields them all at once at the end. Naive `for page in engine.predict(...)` shows "0%" for the entire run, then jumps to "100%" — feels frozen.

**Solution** (in `app/ocr_engine.py`): split PDF into single-page temp files via PyMuPDF, loop `engine.predict(single_page.pdf)` per page. Real progress callback fires between pages.

**Trade-off**: ~15% slower than batch (38 pages: 46s vs 40s), but progress is honest.

### 4.2. Per-sub-model stage callbacks

**Problem**: even with per-page split, the user wants to see WHICH model is currently working ("layout" vs "table" vs "text").

**Solution**: monkey-patch `engine.paddlex_pipeline._pipeline.layout_det_model` etc. with a `_Hooked` callable proxy that fires `on_stage_start(name)` before delegating.

**Subtlety**: `engine.paddlex_pipeline` is an `AutoParallelSimpleInferencePipeline` wrapper that proxies attribute READS via `__getattr__` but doesn't propagate `setattr`. Hooks must be installed on the **inner** `_pipeline` (single-device) or `_pipelines[*]` (multi-device), not the wrapper. See `app/ocr_engine.py:install_stage_hooks`.

### 4.3. Hybrid PDF preview cache

**Problem**: rendering 304 PDF pages at full resolution per request is prohibitive. Naive base64-in-JSON for all pages bloats payload to 100+ MB.

**Solution**:
- **Thumbnails** (88px strip, DPI=80): batch render once, cache as `data/docs/{id}/preview/thumb_NNN.jpg`. Subsequent loads from disk are instant.
- **Full-resolution page** (DPI=200): rendered lazily on click, cached as `data/docs/{id}/preview/page_NNN.jpg`. Browser downloads via `<img src="/api/preview/{id}/page/{n}">` with `Cache-Control: max-age=3600`.

Cache lives under the doc dir and is cleaned automatically on `delete_doc_dir`.

### 4.4. DOCX with real formatting (no pandoc)

**Problem**: PaddleOCR returns markdown. Original `md_to_docx` was a 40-line custom parser supporting only headings + tables — DOCX rendered everything else as plain text.

**Solution**: `markdown` library → HTML → BeautifulSoup walker → python-docx. Supports headings, paragraphs, ordered/unordered lists, inline `<strong>/<em>/<code>`, links, code blocks, blockquotes, tables. No `pandoc` dependency. See `app/converters.py`.

### 4.5. Lazy generation of TXT/DOCX

**Problem**: storing all 3 output formats per doc wastes disk; not all users need all formats.

**Solution**: only `result.md` is saved by the worker (canonical source). On the first request to `/api/result/{id}?format=txt|docx`, the server lazily generates from md and caches the produced file. Subsequent requests serve from disk.

### 4.6. Crash recovery + orphan cleanup

**Problem**: server crash mid-OCR leaves docs in `processing` status forever; user-deletes during OCR can leave files on disk.

**Solution**:
- On startup: `recover_processing()` flips all `processing` → `queued` so the worker re-picks them up.
- Hourly background task `run_orphan_cleanup()`: deletes FS dirs without DB rows, marks DB rows without files as `error`.

### 4.7. SQLite migrations as immutable + idempotent steps

**Problem**: SQLite doesn't support `ALTER TABLE ADD CONSTRAINT`. v2 migration needs to add a CHECK constraint on `created_at`.

**Solution**: each `_migrate_to_vN(conn)` is rebuild-safe (drops zombie temp tables on re-run, full BEGIN/COMMIT transaction, FK temporarily off, integrity check before commit). Schema version persisted in `schema_version` table; `init()` applies missing migrations idempotently.

## Architecture

### Backend (`app/`)

| Module | Responsibility |
|---|---|
| `db.py` | SQLite schema + 4 versioned migrations |
| `storage.py` | `ProjectRepo`, `DocumentRepo` (no SQL outside) |
| `files.py` | FS layout: `data/docs/{id}/{original.*, result.*, preview/*.jpg}` |
| `ocr_engine.py` | PPStructureV3 wrapper, per-page split, stage hooks, table column-order fix |
| `preview_render.py` | Lazy disk-cached preview (thumbs + full pages) with progress |
| `converters.py` | md → txt, md → docx (HTML walker) |
| `preview.py` | md/docx → HTML, sanitization via `bleach` |
| `system.py` | Environment info (`nvidia-smi` parsing) |
| `main.py` | FastAPI routes, async worker, lifespan, batch ZIP |

### Frontend (`app/static/src/`)

Vite + TypeScript strict + Tailwind.

| Module | Responsibility |
|---|---|
| `main.ts` | Entry, polling, wiring |
| `api.ts` | Typed fetch client |
| `state.ts` | localStorage (uiLang, panelSizes, sortMode, activeProjectId) |
| `i18n.ts` + `i18n/{ru,en}.json` | Hot-swap RU/EN |
| `types.ts` | Shared API types |
| `projects.ts`, `documents.ts` | Sidebar |
| `source.ts` | PDF/image preview pane |
| `preview.ts` | Result pane (3 tabs: Markdown / Preview / TXT) |
| `statusbar.ts` | Engine + env + project stats |
| `modal.ts`, `toast.ts`, `menu.ts` | UI primitives |
| `splitter.ts` | Resizable panes |
| `drag.ts`, `polling.ts`, `clipboard.ts`, `validation.ts`, `icons.ts` | Utilities |

## Quick start

```bash
# Backend deps
pip install -r requirements.txt

# Frontend build
npm install
npm run build

# Run
uvicorn app.main:app --host 0.0.0.0 --port 8100
```

Open `http://localhost:8100`. Data persists under `./data/`.

**Frontend dev with HMR:**

```bash
npm run dev               # http://localhost:5173 (proxies /api → 8100)
uvicorn app.main:app --port 8100
```

**Docker:**

```bash
mkdir -p data
docker compose up --build
```

Requires NVIDIA Container Toolkit for GPU.

## API

| Method + Path | Purpose |
|---|---|
| `GET /` | UI |
| `POST /api/ocr` | Upload files (queued, no auto-OCR). Form: `files[]`, `project_id` |
| `POST /api/recognize?project_id=N` | Start OCR for queued docs in project |
| `GET /api/status?project_id=N` | Doc list with progress (status, stage, stage_label, current_page/page_count) |
| `GET /api/projects` etc. | Projects CRUD |
| `PATCH /api/documents/{id}` | Move between projects |
| `DELETE /api/documents/{id}` | Delete (409 if processing) |
| `GET /api/result/{id}?format=md\|txt\|docx` | Download result (lazy gen) |
| `GET /api/markdown/{id}?format=md\|txt` | Plain text |
| `GET /api/rendered/{id}?format=md\|docx` | Sanitized HTML |
| `GET /api/preview/{id}/info` | `{count, kind, thumbs_progress}` |
| `GET /api/preview/{id}/thumbs` | All thumbnails as base64-JSON |
| `GET /api/preview/{id}/page/{n}` | Full-res page JPEG (browser-cached) |
| `GET /api/source/{id}` | Original file |
| `GET /api/projects/{id}/zip` | Batch ZIP of completed docs |
| `GET /api/system` | GPU/CUDA/VRAM, engine status, pipeline models list |
| `GET /api/limits` | Max file size, allowed extensions |

## Tests

```bash
pytest                # backend (~180 tests)
npm test              # frontend (vitest + jsdom, ~155 tests)
npm run build         # type-check + production bundle
```

## License

Apache 2.0 (inherited from PaddleOCR).
