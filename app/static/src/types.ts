/**
 * Общие TypeScript-типы для frontend OCR Studio.
 *
 * Редактирование:
 * - Эти типы — контракт между frontend и backend API. Изменения должны коррелировать
 *   с моделями `app/storage.py` (Project, Document) и schemas `app/main.py` (UploadResponse,
 *   RecognizeResponse, PreloadResponse, SystemInfo, ApiLimits).
 * - При расширении DocStatus / OcrFormat / LangCode — обновить i18n bundles (`i18n/ru.json`,
 *   `i18n/en.json`) с соответствующими ключами `doc.status.*` / `tab.*` / etc.
 * - Не добавлять методы или утилиты — этот модуль только декларации типов.
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
  id: number;
  project_id: number;
  filename: string;
  size_bytes: number;
  format: OcrFormat;
  lang: LangCode;
  status: DocStatus;
  created_at: string;
  page_count?: number;
  current_page?: number;
  progress_percent?: number;
  elapsed_seconds?: number;
  eta_seconds?: number;
  error_message?: string;
}

export interface SystemInfo {
  gpu: string | null;
  cuda: string | null;
  vram_gb: number | null;
  engine_lang: LangCode | null;
  engine_status: 'ready' | 'loading' | 'idle';
}

export interface ApiLimits {
  max_file_size_bytes: number;
  allowed_extensions: string[];
}

export interface UploadWarning {
  id: number;
  type: 'long_processing';
  pages: number;
}

export interface UploadResponse {
  ids: number[];
  warnings: UploadWarning[];
}

export interface RecognizeResponse {
  started: number;
  doc_ids: number[];
}

export interface PreloadResponse {
  status: 'loading' | 'ready';
}

export interface PreviewData {
  pages: string[];
}
