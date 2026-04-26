import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tabsForFormat, renderResult } from '../../app/static/src/preview';
import type { Document } from '../../app/static/src/types';
import { loadLang } from '../../app/static/src/i18n';

const baseDoc = (overrides: Partial<Document>): Document => ({
  id: 'a1', project_id: 1, filename: 'x.md', size_bytes: 0,
  format: 'md', lang: 'ru', status: 'done',
  created_at: 'x', started_at: null, finished_at: null,
  page_count: null, current_page: null, progress_percent: null,
  elapsed_seconds: null, eta_seconds: null, error: null,
  ...overrides,
});

describe('tabsForFormat', () => {
  beforeEach(() => loadLang('ru'));

  it('md → 2 tabs (markdown + preview)', () => {
    expect(tabsForFormat('md').map(t => t.key)).toEqual(['markdown', 'preview']);
  });
  it('txt → 1 tab (text)', () => {
    expect(tabsForFormat('txt').map(t => t.key)).toEqual(['text']);
  });
  it('docx → 1 tab (document)', () => {
    expect(tabsForFormat('docx').map(t => t.key)).toEqual(['document']);
  });
  it('labels are localized', () => {
    const tabs = tabsForFormat('md');
    expect(tabs[0]?.label).toBe('Markdown');
    expect(tabs[1]?.label).toBe('Превью');
    loadLang('en');
    expect(tabsForFormat('md')[1]?.label).toBe('Preview');
  });
});

describe('renderResult', () => {
  beforeEach(() => { loadLang('ru'); document.body.innerHTML = '<div id="r"></div>'; });

  it('shows empty state when no doc', async () => {
    await renderResult(document.getElementById('r')!, null, 'markdown', { getMarkdown: async () => '', getRendered: async () => '' });
    expect(document.body.textContent).toContain('Выберите документ');
  });

  it('shows unavailable when doc not done', async () => {
    const doc = baseDoc({ status: 'queued' });
    await renderResult(document.getElementById('r')!, doc, 'markdown', { getMarkdown: async () => '', getRendered: async () => '' });
    expect(document.body.textContent).toContain('Превью недоступно');
  });

  it('renders markdown text in pre', async () => {
    const doc = baseDoc({ id: '1', format: 'md' });
    await renderResult(document.getElementById('r')!, doc, 'markdown', {
      getMarkdown: async () => '# Title\nbody',
      getRendered: async () => '',
    });
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toContain('# Title');
  });

  it('renders rendered HTML for preview tab', async () => {
    const doc = baseDoc({ id: '2' });
    await renderResult(document.getElementById('r')!, doc, 'preview', {
      getMarkdown: async () => '',
      getRendered: async () => '<h1>Rendered</h1>',
    });
    expect(document.querySelector('h1')?.textContent).toBe('Rendered');
  });

  it('renders text for txt format text tab', async () => {
    const doc = baseDoc({ id: '3', format: 'txt' });
    await renderResult(document.getElementById('r')!, doc, 'text', {
      getMarkdown: async () => 'plain text content',
      getRendered: async () => '',
    });
    expect(document.querySelector('pre')?.textContent).toContain('plain text content');
  });

  it('renders document html for docx format', async () => {
    const doc = baseDoc({ id: '4', format: 'docx' });
    await renderResult(document.getElementById('r')!, doc, 'document', {
      getMarkdown: async () => '',
      getRendered: async () => '<p>Word content</p>',
    });
    expect(document.querySelector('p')?.textContent).toBe('Word content');
  });

  it('shows unavailable on api error', async () => {
    const doc = baseDoc({ id: '5' });
    const failingApi = {
      getMarkdown: vi.fn().mockRejectedValue(new Error('boom')),
      getRendered: vi.fn().mockRejectedValue(new Error('boom')),
    };
    await renderResult(document.getElementById('r')!, doc, 'markdown', failingApi);
    expect(document.body.textContent).toContain('Превью недоступно');
  });

  it('escapes HTML in markdown text', async () => {
    const doc = baseDoc({ id: '6' });
    await renderResult(document.getElementById('r')!, doc, 'markdown', {
      getMarkdown: async () => '<script>alert(1)</script>',
      getRendered: async () => '',
    });
    expect(document.body.innerHTML).not.toContain('<script>alert');
    expect(document.querySelector('pre')?.innerHTML).toContain('&lt;script&gt;');
  });
});
