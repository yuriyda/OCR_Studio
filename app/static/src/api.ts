/**
 * Typed fetch client for the OCR Studio backend.
 *
 * Maintenance notes:
 * - Do NOT store state, do NOT add business logic. Only `fetch()` wrappers
 *   with response types from `./types`.
 * - When a new endpoint is added to `app/main.py` — add the corresponding
 *   method here plus the response type in `types.ts`.
 * - Document IDs are `string` (uuid hex); project IDs are `number`.
 * - URL builders (`sourceUrl`, `resultUrl`, `projectZipUrl`) return strings —
 *   used for `window.open()` and `<img src=...>`, not for fetch.
 * - Errors throw `ApiError` with a numeric `status` for convenient UI handling
 *   (e.g. 409 → toast "wait for processing to finish").
 */

import type {
  Project, Document, SystemInfo, ApiLimits, UploadResponse,
  RecognizeResponse, PreviewInfo, PreviewThumbs, OcrFormat,
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
  // 204 No Content (DELETE /api/documents/{id}, /api/projects/{id}) — empty body;
  // resp.json() would throw SyntaxError on an empty string.
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

  async uploadDocs(filesList: File[], projectId: number): Promise<UploadResponse> {
    // Backend `/api/ocr` reads project_id as a Form field; format is no longer used
    // (worker always saves result.md; other formats are generated lazily).
    const fd = new FormData();
    for (const f of filesList) fd.append('files', f);
    fd.append('project_id', String(projectId));
    return _json(await fetch('/api/ocr', {
      method: 'POST', body: fd,
    }));
  },
  async recognizeProject(projectId: number): Promise<RecognizeResponse> {
    return _json(await fetch(`/api/recognize?project_id=${projectId}`, { method: 'POST' }));
  },

  async getMarkdown(docId: string, format: 'md' | 'txt' = 'md'): Promise<string> {
    return _text(await fetch(`/api/markdown/${docId}?format=${format}`));
  },
  async getRendered(docId: string, format: 'md' | 'docx' = 'md'): Promise<string> {
    return _text(await fetch(`/api/rendered/${docId}?format=${format}`));
  },
  async getPreviewInfo(docId: string): Promise<PreviewInfo> {
    return _json(await fetch(`/api/preview/${docId}/info`));
  },
  async getPreviewThumbs(docId: string): Promise<PreviewThumbs> {
    return _json(await fetch(`/api/preview/${docId}/thumbs`));
  },
  previewPageUrl(docId: string, pageNum: number): string {
    return `/api/preview/${docId}/page/${pageNum}`;
  },
  async getSystemInfo(): Promise<SystemInfo> {
    return _json(await fetch('/api/system'));
  },
  async getLimits(): Promise<ApiLimits> {
    return _json(await fetch('/api/limits'));
  },

  sourceUrl(docId: string): string { return `/api/source/${docId}`; },
  resultUrl(docId: string, format: OcrFormat): string { return `/api/result/${docId}?format=${format}`; },
  projectZipUrl(projectId: number): string { return `/api/projects/${projectId}/zip`; },
};
