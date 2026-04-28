import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, ApiError } from '../../app/static/src/api';

const mockFetch = (data: unknown, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({
    ok,
    status,
    headers: { get: () => null },
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  });

describe('api client', () => {
  beforeEach(() => { (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(); });

  it('listProjects returns array', async () => {
    (globalThis as any).fetch = mockFetch([{ id: 1, name: 'Inbox', doc_count: 0, total_bytes: 0, created_at: 'x' }]);
    const r = await api.listProjects();
    expect(r).toHaveLength(1);
    expect(r[0]?.name).toBe('Inbox');
  });

  it('createProject posts json body', async () => {
    const f = mockFetch({ id: 5, name: 'New', doc_count: 0, total_bytes: 0, created_at: 'x' });
    (globalThis as any).fetch = f;
    const r = await api.createProject('New');
    expect(f).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New' }),
    }));
    expect(r.id).toBe(5);
  });

  it('renameProject PATCHes', async () => {
    const f = mockFetch({ id: 5, name: 'Renamed', doc_count: 0, total_bytes: 0, created_at: 'x' });
    (globalThis as any).fetch = f;
    await api.renameProject(5, 'Renamed');
    expect(f).toHaveBeenCalledWith('/api/projects/5', expect.objectContaining({ method: 'PATCH' }));
  });

  it('deleteProject DELETEs', async () => {
    const f = mockFetch({});
    (globalThis as any).fetch = f;
    await api.deleteProject(7);
    expect(f).toHaveBeenCalledWith('/api/projects/7', expect.objectContaining({ method: 'DELETE' }));
  });

  it('listDocuments returns Document[]', async () => {
    (globalThis as any).fetch = mockFetch([
      { id: 'a1', project_id: 1, filename: 'x.pdf', size_bytes: 100, format: 'md', lang: 'ru', status: 'queued',
        created_at: 'x', started_at: null, finished_at: null,
        page_count: null, current_page: null, progress_percent: null, elapsed_seconds: null, eta_seconds: null,
        error: null, available_formats: [] },
    ]);
    const r = await api.listDocuments(1, 'created', 'desc');
    expect(r).toHaveLength(1);
    expect(r[0]?.id).toBe('a1');
  });

  it('moveDocument PATCHes with project_id body', async () => {
    const f = mockFetch({});
    (globalThis as any).fetch = f;
    await api.moveDocument('a1b2c3', 5);
    expect(f).toHaveBeenCalledWith('/api/documents/a1b2c3', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ project_id: 5 }),
    }));
  });

  it('deleteDocument DELETEs', async () => {
    const f = mockFetch({});
    (globalThis as any).fetch = f;
    await api.deleteDocument('a1b2c3');
    expect(f).toHaveBeenCalledWith('/api/documents/a1b2c3', expect.objectContaining({ method: 'DELETE' }));
  });

  it('deleteDocument tolerates 204 No Content (regression: SyntaxError "Unexpected end of JSON input")', async () => {
    // Real backend returns 204 with empty body for DELETE /api/documents/{id}.
    // resp.json() on empty body throws SyntaxError → caught in UI as "Unexpected end of JSON input".
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? '0' : null) },
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
      text: async () => '',
    });
    (globalThis as any).fetch = f;
    await expect(api.deleteDocument('abc123')).resolves.toBeUndefined();
  });

  it('deleteProject tolerates 204 No Content (same regression)', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? '0' : null) },
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
      text: async () => '',
    });
    (globalThis as any).fetch = f;
    await expect(api.deleteProject(7)).resolves.toBeUndefined();
  });

  it('uploadDocs sends project_id as FormData (format dropped — worker always saves md)', async () => {
    const f = mockFetch({ ids: ['x'], warnings: [], errors: [] });
    (globalThis as any).fetch = f;
    const file = new File(['data'], 't.pdf', { type: 'application/pdf' });
    const r = await api.uploadDocs([file], 5);
    expect(r.ids).toEqual(['x']);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ocr');
    expect(init.method).toBe('POST');
    const body = init.body as FormData;
    expect(body instanceof FormData).toBe(true);
    expect(body.get('project_id')).toBe('5');
    expect(body.get('format')).toBeNull();
  });

  it('recognizeProject POSTs query param', async () => {
    const f = mockFetch({ started: 2, doc_ids: ['a', 'b'] });
    (globalThis as any).fetch = f;
    const r = await api.recognizeProject(5);
    expect(f).toHaveBeenCalledWith('/api/recognize?project_id=5', expect.objectContaining({ method: 'POST' }));
    expect(r.started).toBe(2);
  });

  it('getMarkdown defaults to format=md', async () => {
    const f = mockFetch('# md');
    (globalThis as any).fetch = f;
    await api.getMarkdown('a1');
    expect(f).toHaveBeenCalledWith('/api/markdown/a1?format=md');
  });

  it('getMarkdown can request format=txt', async () => {
    const f = mockFetch('plain');
    (globalThis as any).fetch = f;
    await api.getMarkdown('a1', 'txt');
    expect(f).toHaveBeenCalledWith('/api/markdown/a1?format=txt');
  });

  it('getRendered defaults to format=md', async () => {
    const f = mockFetch('<h1>x</h1>');
    (globalThis as any).fetch = f;
    await api.getRendered('a1');
    expect(f).toHaveBeenCalledWith('/api/rendered/a1?format=md');
  });

  it('getRendered can request format=docx', async () => {
    const f = mockFetch('<p>doc</p>');
    (globalThis as any).fetch = f;
    await api.getRendered('a1', 'docx');
    expect(f).toHaveBeenCalledWith('/api/rendered/a1?format=docx');
  });

  it('getPreviewInfo returns count and kind', async () => {
    (globalThis as any).fetch = mockFetch({ count: 5, kind: 'pdf', thumbs_progress: null });
    const r = await api.getPreviewInfo('a1');
    expect(r.count).toBe(5);
    expect(r.kind).toBe('pdf');
    expect(r.thumbs_progress).toBeNull();
  });

  it('getPreviewThumbs returns base64 pages', async () => {
    (globalThis as any).fetch = mockFetch({ pages: ['BASE64A', 'BASE64B'] });
    const r = await api.getPreviewThumbs('a1');
    expect(r.pages).toEqual(['BASE64A', 'BASE64B']);
  });

  it('previewPageUrl builds direct URL', () => {
    expect(api.previewPageUrl('a1', 3)).toBe('/api/preview/a1/page/3');
  });

  it('getSystemInfo and getLimits work', async () => {
    (globalThis as any).fetch = mockFetch({ gpu: 'X', cuda: 'Y', vram_gb: 16, engine_lang: 'ru', engine_status: 'ready' });
    expect((await api.getSystemInfo()).gpu).toBe('X');
    (globalThis as any).fetch = mockFetch({ max_file_size_bytes: 1000, allowed_extensions: ['.pdf'] });
    expect((await api.getLimits()).max_file_size_bytes).toBe(1000);
  });

  it('resultUrl requires format param', () => {
    expect(api.resultUrl('a1', 'docx')).toBe('/api/result/a1?format=docx');
    expect(api.resultUrl('a1', 'md')).toBe('/api/result/a1?format=md');
  });

  it('builds direct URLs', () => {
    expect(api.sourceUrl('a1')).toBe('/api/source/a1');
    expect(api.projectZipUrl(7)).toBe('/api/projects/7/zip');
  });

  it('throws ApiError with status code on error', async () => {
    (globalThis as any).fetch = mockFetch({ detail: 'nope' }, false, 409);
    await expect(api.deleteProject(99)).rejects.toMatchObject({ status: 409 });
  });

  it('ApiError is exported', () => {
    const err = new ApiError('test', 500);
    expect(err.status).toBe(500);
    expect(err.name).toBe('ApiError');
  });
});

// ---------------------------------------------------------------------------
// Settings / reload / re-OCR named exports
// ---------------------------------------------------------------------------
import * as apiNs from '../../app/static/src/api';

describe('settings api', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('getSettings GETs /api/settings', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ hq_mode: false, hq_orientation: false, onboarding_seen: false }),
    });
    const cfg = await apiNs.getSettings();
    expect(global.fetch).toHaveBeenCalledWith('/api/settings');
    expect(cfg.hq_mode).toBe(false);
  });

  it('putSettings PUTs JSON body', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'reloading' }),
    });
    await apiNs.putSettings({ hq_mode: true, hq_orientation: true } as any);
    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('/api/settings');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body).hq_mode).toBe(true);
  });

  it('dismissOnboarding POSTs to dismiss', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    await apiNs.dismissOnboarding();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/settings/onboarding/dismiss',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reocrDoc POSTs to /api/documents/{id}/reocr', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) });
    await apiNs.reocrDoc('abc');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/documents/abc/reocr',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reocrProject POSTs to /api/projects/{id}/reocr', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) });
    await apiNs.reocrProject(7);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/7/reocr',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
