/**
 * Общие TypeScript-типы для frontend OCR Studio.
 *
 * Редактирование:
 * - Эти типы — контракт между frontend и backend API. Изменения должны коррелировать
 *   с моделями `app/storage.py` (Project, Document) и schemas `app/main.py`
 *   (`_doc_response`, `/api/system`, `/api/limits`, `/api/ocr`, `/api/recognize`,
 *   `/api/engine/preload`, `/api/preview/{id}`).
 * - При расширении DocStatus / OcrFormat / LangCode — обновить i18n bundles
 *   (`i18n/ru.json`, `i18n/en.json`) с соответствующими ключами `doc.status.*` / `tab.*`.
 * - ID документов — string (UUID hex из `app/db.py: documents.id TEXT PRIMARY KEY`).
 *   ID проектов — number (`projects.id INTEGER PRIMARY KEY AUTOINCREMENT`).
 * - Поля прогресса (`page_count`, `current_page`, `progress_percent`, `elapsed_seconds`,
 *   `eta_seconds`) и timestamps (`started_at`, `finished_at`) бэкенд возвращает всегда:
 *   `T | null`, не `T?`. Не делать их optional, иначе `noUncheckedIndexedAccess` пропустит баг.
 * - Не добавлять методы или утилиты — этот модуль только декларации типов.
 * - `created_at` приходит как ISO-8601 TEXT (CHECK constraint на формат добавлен в db.py).
 *   На стороне TS — string. Native Date не используем, чтобы избежать драм с UTC/локалью.
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
  stage_label: string | null;
}

export interface SystemInfo {
  gpu: string | null;
  cuda: string | null;
  vram_gb: number | null;
  engine_lang: LangCode | null;
  /** Бэкенд возвращает только 'loading' | 'ready'. 'idle' — frontend-only initial cache. */
  engine_status: 'ready' | 'loading' | 'idle';
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
  /** Base64-encoded JPEG bytes (без data: prefix). */
  pages: string[];
}
