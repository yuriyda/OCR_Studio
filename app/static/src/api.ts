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

// ---------------------------------------------------------------------------
// Settings / reload / re-OCR — named exports used by settings UI components
// ---------------------------------------------------------------------------

export interface HqConfig {
  hq_mode: boolean;
  hq_orientation: boolean;
  hq_unwarping: boolean;
  hq_textline: boolean;
  hq_chart: boolean;
  hq_seal: boolean;
}

export interface SettingsResponse extends HqConfig {
  onboarding_seen: boolean;
}

/** Fetch current HQ-mode settings from the backend. */
export async function getSettings(): Promise<SettingsResponse> {
  const r = await fetch('/api/settings');
  if (!r.ok) throw new ApiError(`getSettings failed`, r.status);
  return r.json();
}

/** Persist updated settings; backend may respond with { status: 'reloading' } when engine restarts. */
export async function putSettings(config: Partial<HqConfig>): Promise<{ status: string }> {
  const r = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!r.ok) {
    let detail: Record<string, unknown> = {};
    try { detail = await r.json(); } catch { /* non-JSON body */ }
    throw Object.assign(new ApiError(`putSettings ${r.status}`, r.status), { detail });
  }
  return r.json();
}

/** Mark onboarding banner as dismissed (POST, no body). */
export async function dismissOnboarding(): Promise<void> {
  const r = await fetch('/api/settings/onboarding/dismiss', { method: 'POST' });
  if (!r.ok) throw new ApiError(`dismissOnboarding failed`, r.status);
}

/** Re-queue a single document for OCR. */
export async function reocrDoc(docId: string): Promise<unknown> {
  const r = await fetch(`/api/documents/${docId}/reocr`, { method: 'POST' });
  if (!r.ok) throw new ApiError(`reocrDoc failed`, r.status);
  return r.json();
}

/** Re-queue all documents in a project for OCR. Returns number of re-queued docs. */
export async function reocrProject(projectId: number): Promise<{ requeued: number; doc_ids: string[] }> {
  const r = await fetch(`/api/projects/${projectId}/reocr`, { method: 'POST' });
  if (!r.ok) throw new ApiError(`reocrProject failed`, r.status);
  return r.json();
}

/** Shape of events emitted by the /api/settings/reload-stream SSE endpoint. */
export type ReloadEvent =
  | { loaded: number; total: number; current: string | null; done: false; error: null }
  | { done: true; error: string | null };

/**
 * Open an SSE stream to watch the engine reload progress.
 *
 * @param onEvent  Called for each parsed reload event.
 * @param onClose  Called when the stream closes (done or error).
 * @returns        Cleanup function — call it to close the EventSource early.
 */
export function streamReload(
  onEvent: (ev: ReloadEvent) => void,
  onClose: () => void,
): () => void {
  const es = new EventSource('/api/settings/reload-stream');
  es.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data) as ReloadEvent;
      onEvent(data);
      if ((data as { done: boolean }).done) {
        es.close();
        onClose();
      }
    } catch {
      // malformed SSE payload — skip silently
    }
  };
  es.onerror = () => {
    es.close();
    onClose();
  };
  return () => es.close();
}
