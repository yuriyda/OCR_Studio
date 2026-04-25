import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../app/static/js/api.js';

describe('api', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('listProjects calls /api/projects', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    await api.listProjects();
    expect(fetch).toHaveBeenCalledWith('/api/projects');
  });

  it('createProject sends POST with name', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    await api.createProject('X');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('/api/projects');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ name: 'X' });
  });

  it('listDocuments includes project_id and sort params', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    await api.listDocuments(5, 'name', 'asc');
    expect(fetch.mock.calls[0][0]).toContain('project_id=5');
    expect(fetch.mock.calls[0][0]).toContain('sort=name');
    expect(fetch.mock.calls[0][0]).toContain('order=asc');
  });

  it('throws on 4xx', async () => {
    fetch.mockResolvedValue({ ok: false, status: 409, text: () => Promise.resolve('conflict') });
    await expect(api.createProject('X')).rejects.toMatchObject({ status: 409 });
  });

  it('moveDocument PATCH with project_id', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    await api.moveDocument('abc', 7);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('/api/documents/abc');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ project_id: 7 });
  });
});
