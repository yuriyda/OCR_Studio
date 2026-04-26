import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, ApiError } from '../../app/static/src/api';

const mockFetch = (data: unknown, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({
    ok,
    status,
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
        error: null },
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

  it('uploadDocs builds FormData', async () => {
    const f = mockFetch({ ids: ['x'], warnings: [], errors: [] });
    (globalThis as any).fetch = f;
    const file = new File(['data'], 't.pdf', { type: 'application/pdf' });
    const r = await api.uploadDocs([file], 'md', 'ru', 1);
    expect(r.ids).toEqual(['x']);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ocr?project_id=1&format=md&lang=ru');
    expect(init.method).toBe('POST');
    expect(init.body instanceof FormData).toBe(true);
  });

  it('recognizeProject POSTs query param', async () => {
    const f = mockFetch({ started: 2, doc_ids: ['a', 'b'] });
    (globalThis as any).fetch = f;
    const r = await api.recognizeProject(5);
    expect(f).toHaveBeenCalledWith('/api/recognize?project_id=5', expect.objectContaining({ method: 'POST' }));
    expect(r.started).toBe(2);
  });

  it('preloadEngine returns status', async () => {
    (globalThis as any).fetch = mockFetch({ status: 'loading' });
    const r = await api.preloadEngine('en');
    expect(r.status).toBe('loading');
  });

  it('getMarkdown returns text', async () => {
    (globalThis as any).fetch = mockFetch('# hello');
    const r = await api.getMarkdown('a1');
    expect(r).toBe('# hello');
  });

  it('getRendered returns html text', async () => {
    (globalThis as any).fetch = mockFetch('<h1>hi</h1>');
    const r = await api.getRendered('a1');
    expect(r).toBe('<h1>hi</h1>');
  });

  it('getPreview returns pages array', async () => {
    (globalThis as any).fetch = mockFetch({ pages: ['BASE64'] });
    const r = await api.getPreview('a1');
    expect(r.pages).toEqual(['BASE64']);
  });

  it('getSystemInfo and getLimits work', async () => {
    (globalThis as any).fetch = mockFetch({ gpu: 'X', cuda: 'Y', vram_gb: 16, engine_lang: 'ru', engine_status: 'ready' });
    expect((await api.getSystemInfo()).gpu).toBe('X');
    (globalThis as any).fetch = mockFetch({ max_file_size_bytes: 1000, allowed_extensions: ['.pdf'] });
    expect((await api.getLimits()).max_file_size_bytes).toBe(1000);
  });

  it('builds direct URLs', () => {
    expect(api.sourceUrl('a1')).toBe('/api/source/a1');
    expect(api.resultUrl('a1')).toBe('/api/result/a1');
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
