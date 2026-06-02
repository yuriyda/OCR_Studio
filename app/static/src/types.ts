/**
 * Shared TypeScript types for the OCR Studio frontend.
 *
 * Maintenance notes:
 * - These types are the contract between the frontend and the backend API. Changes must be
 *   correlated with models in `app/storage.py` (Project, Document) and schemas in `app/main.py`
 *   (`_doc_response`, `/api/system`, `/api/limits`, `/api/ocr`, `/api/recognize`,
 *   `/api/engine/preload`, `/api/preview/{id}`).
 * - When extending DocStatus / OcrFormat / LangCode — update i18n bundles
 *   (`i18n/ru.json`, `i18n/en.json`) with the corresponding `doc.status.*` / `tab.*` keys.
 * - Document IDs — string (UUID hex from `app/db.py: documents.id TEXT PRIMARY KEY`).
 *   Project IDs — number (`projects.id INTEGER PRIMARY KEY AUTOINCREMENT`).
 * - Progress fields (`page_count`, `current_page`, `progress_percent`, `elapsed_seconds`,
 *   `eta_seconds`) and timestamps (`started_at`, `finished_at`) are always returned by the
 *   backend as `T | null`, not `T?`. Do not make them optional — `noUncheckedIndexedAccess` would miss the bug.
 * - Do not add methods or utilities — this module contains only type declarations.
 * - `created_at` arrives as ISO-8601 TEXT (CHECK constraint on format added in db.py).
 *   On the TS side — string. Native Date is not used to avoid UTC/locale issues.
 */

export type LangCode = 'ru' | 'en';
export type OcrFormat = 'md' | 'txt' | 'docx';
export type DocStatus = 'queued' | 'processing' | 'done' | 'error';

export interface Project {
  id: number;
  name: string;
  doc_count: number;
  total_bytes: number;
  created_at: string;
}

export interface Document {
  id: string;
  project_id: number;
  filename: string;
  size_bytes: number;
  format: OcrFormat;
  lang: LangCode;
  status: DocStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  page_count: number | null;
  current_page: number | null;
  progress_percent: number | null;
  elapsed_seconds: number | null;
  eta_seconds: number | null;
  error: string | null;
  available_formats: string[];
  stage: 'engine_loading' | 'ocr' | null;
  stage_detail: string | null;
  stage_label: string | null;
}

export interface PipelineModel {
  role: string;
  name: string;
}

export interface HqRecommendation {
  hq_mode: 'on' | 'off';
  reason: string;
  warning: string | null;
}

export interface QueueCounts {
  queued: number;
  processing: number;
  completed_since_start: number;
}

export interface SystemInfo {
  gpu: string | null;
  cuda: string | null;
  vram_gb: number | null;
  engine_lang: LangCode | null;
  /** Backend returns only 'loading' | 'ready'. 'idle' — frontend-only initial cache value. */
  engine_status: 'ready' | 'loading' | 'idle';
  engine_pipeline: PipelineModel[];
  recommendation: HqRecommendation;
  queue: QueueCounts;
}

export interface ApiLimits {
  max_file_size_bytes: number;
  allowed_extensions: string[];
}

export interface UploadWarning {
  id: string;
  type: 'long_processing';
  pages: number;
}

export interface UploadResponse {
  ids: string[];
  warnings: UploadWarning[];
}

export interface RecognizeResponse {
  started: number;
  doc_ids: string[];
}

export interface PreloadResponse {
  status: 'loading' | 'ready';
}

export interface PreviewInfo {
  count: number;
  kind: 'pdf' | 'image';
  thumbs_progress: { current: number; total: number } | null;
}

export interface PreviewThumbs {
  /** Base64-encoded JPEG bytes (without data: prefix). */
  pages: string[];
}
