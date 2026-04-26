/**
 * Типизированный fetch-клиент к backend OCR Studio.
 *
 * Редактирование:
 * - НЕ хранить состояние, НЕ делать бизнес-логику. Только обёртки над `fetch()`
 *   с типизацией ответов из `./types`.
 * - При появлении нового endpoint в `app/main.py` — добавить соответствующий
 *   метод сюда + тип ответа в `types.ts`.
 * - Помечать ID документов как `string` (uuid hex), ID проектов как `number`.
 * - URL-builders (`sourceUrl`, `resultUrl`, `projectZipUrl`) возвращают строки —
 *   используются для `window.open()` и `<img src=...>`, не для fetch.
 * - Ошибки выбрасывают `ApiError` с числовым `status` для удобной обработки UI
 *   (например, 409 → toast «дождитесь обработки»).
 */

import type {
  Project, Document, SystemInfo, ApiLimits, UploadResponse,
  RecognizeResponse, PreviewData, OcrFormat,
} from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function _json<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const body = await resp.json();
      detail = (body && typeof body === 'object' && 'detail' in body) ? String(body.detail) : detail;
    } catch { /* body wasn't JSON */ }
    throw new ApiError(detail, resp.status);
  }
  // 204 No Content (DELETE /api/documents/{id}, /api/projects/{id}) — пустое тело,
  // resp.json() бросит SyntaxError на пустой строке.
  if (resp.status === 204 || resp.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return resp.json() as Promise<T>;
}

async function _text(resp: Response): Promise<string> {
  if (!resp.ok) throw new ApiError(resp.statusText, resp.status);
  return resp.text();
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export const api = {
  async listProjects(): Promise<Project[]> {
    return _json(await fetch('/api/projects'));
  },
  async createProject(name: string): Promise<Project> {
    return _json(await fetch('/api/projects', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }),
    }));
  },
  async renameProject(id: number, name: string): Promise<Project> {
    return _json(await fetch(`/api/projects/${id}`, {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ name }),
    }));
  },
  async deleteProject(id: number): Promise<void> {
    await _json(await fetch(`/api/projects/${id}`, { method: 'DELETE' }));
  },

  async listDocuments(projectId: number, sort: string, order: string): Promise<Document[]> {
    return _json(await fetch(`/api/status?project_id=${projectId}&sort=${sort}&order=${order}`));
  },
  async moveDocument(docId: string, projectId: number): Promise<void> {
    await _json(await fetch(`/api/documents/${docId}`, {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ project_id: projectId }),
    }));
  },
  async deleteDocument(docId: string): Promise<void> {
    await _json(await fetch(`/api/documents/${docId}`, { method: 'DELETE' }));
  },

  async uploadDocs(filesList: File[], format: OcrFormat, projectId: number): Promise<UploadResponse> {
    const fd = new FormData();
    for (const f of filesList) fd.append('files', f);
    return _json(await fetch(`/api/ocr?project_id=${projectId}&format=${format}`, {
      method: 'POST', body: fd,
    }));
  },
  async recognizeProject(projectId: number): Promise<RecognizeResponse> {
    return _json(await fetch(`/api/recognize?project_id=${projectId}`, { method: 'POST' }));
  },

  async getMarkdown(docId: string): Promise<string> {
    return _text(await fetch(`/api/markdown/${docId}`));
  },
  async getRendered(docId: string): Promise<string> {
    return _text(await fetch(`/api/rendered/${docId}`));
  },
  async getPreview(docId: string): Promise<PreviewData> {
    return _json(await fetch(`/api/preview/${docId}`));
  },
  async getSystemInfo(): Promise<SystemInfo> {
    return _json(await fetch('/api/system'));
  },
  async getLimits(): Promise<ApiLimits> {
    return _json(await fetch('/api/limits'));
  },

  sourceUrl(docId: string): string { return `/api/source/${docId}`; },
  resultUrl(docId: string): string { return `/api/result/${docId}`; },
  projectZipUrl(projectId: number): string { return `/api/projects/${projectId}/zip`; },
};
