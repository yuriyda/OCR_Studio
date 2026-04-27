import { describe, it, expect, beforeEach } from 'vitest';
import { allResultTabs, TAB_TO_FORMAT, isTabAvailable, renderResult } from '../../app/static/src/preview';
import type { Document } from '../../app/static/src/types';
import { loadLang } from '../../app/static/src/i18n';

const baseDoc = (overrides: Partial<Document>): Document => ({
  id: 'a1', project_id: 1, filename: 'x.md', size_bytes: 0,
  format: 'md', lang: 'ru', status: 'done',
  created_at: 'x', started_at: null, finished_at: null,
  page_count: null, current_page: null, progress_percent: null,
  elapsed_seconds: null, eta_seconds: null, error: null,
  available_formats: ['md'], stage: null, stage_detail: null, stage_label: null,
  ...overrides,
});

describe('allResultTabs', () => {
  beforeEach(() => loadLang('ru'));

  it('returns 3 fixed tabs', () => {
    expect(allResultTabs().map(t => t.key)).toEqual(['markdown', 'preview', 'text']);
  });

  it('allResultTabs returns 3 tabs without document', () => {
    const tabs = allResultTabs();
    const keys = tabs.map(t => t.key);
    expect(keys).toEqual(['markdown', 'preview', 'text']);
  });

  it('labels are localized', () => {
    expect(allResultTabs()[0]?.label).toBe('Markdown');
    expect(allResultTabs()[1]?.label).toBe('Превью');
    loadLang('en');
    expect(allResultTabs()[1]?.label).toBe('Preview');
  });
});

describe('TAB_TO_FORMAT mapping', () => {
  it('maps tab keys to backend format strings', () => {
    expect(TAB_TO_FORMAT.markdown).toBe('md');
    expect(TAB_TO_FORMAT.preview).toBe('md');
    expect(TAB_TO_FORMAT.text).toBe('txt');
  });

  it('TAB_TO_FORMAT does not include document', () => {
    expect(TAB_TO_FORMAT).not.toHaveProperty('document');
  });
});

describe('isTabAvailable', () => {
  it('markdown/preview need md in available_formats', () => {
    expect(isTabAvailable('markdown', ['md'])).toBe(true);
    expect(isTabAvailable('markdown', ['txt'])).toBe(false);
    expect(isTabAvailable('preview', ['md'])).toBe(true);
    expect(isTabAvailable('preview', ['docx'])).toBe(false);
  });

  it('text available if md or txt present', () => {
    expect(isTabAvailable('text', ['md'])).toBe(true);
    expect(isTabAvailable('text', ['txt'])).toBe(true);
    expect(isTabAvailable('text', ['docx'])).toBe(false);
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

  it('shows source_unavailable for unavailable tab on legacy doc', async () => {
    const doc = baseDoc({ available_formats: ['txt'] });
    await renderResult(document.getElementById('r')!, doc, 'markdown', { getMarkdown: async () => '', getRendered: async () => '' });
    expect(document.body.textContent).toContain('Источник недоступен');
  });

  it('renders markdown tab via getMarkdown(md)', async () => {
    const doc = baseDoc({ id: '1' });
    const calls: Array<[string, string]> = [];
    await renderResult(document.getElementById('r')!, doc, 'markdown', {
      getMarkdown: async (id, fmt) => { calls.push([id, fmt ?? 'md']); return '# h'; },
      getRendered: async () => '',
    });
    expect(calls).toEqual([['1', 'md']]);
    expect(document.querySelector('pre')?.textContent).toContain('# h');
  });

  it('renders text tab via getMarkdown(txt)', async () => {
    const doc = baseDoc({ id: '2' });
    const calls: Array<[string, string]> = [];
    await renderResult(document.getElementById('r')!, doc, 'text', {
      getMarkdown: async (id, fmt) => { calls.push([id, fmt ?? 'md']); return 'plain'; },
      getRendered: async () => '',
    });
    expect(calls).toEqual([['2', 'txt']]);
    expect(document.querySelector('pre')?.textContent).toBe('plain');
  });

  it('renders preview tab via getRendered(md)', async () => {
    const doc = baseDoc({ id: '3' });
    const calls: Array<[string, string]> = [];
    await renderResult(document.getElementById('r')!, doc, 'preview', {
      getMarkdown: async () => '',
      getRendered: async (id, fmt) => { calls.push([id, fmt ?? 'md']); return '<h1>p</h1>'; },
    });
    expect(calls).toEqual([['3', 'md']]);
    expect(document.querySelector('h1')?.textContent).toBe('p');
  });

  it('shows error state on api failure', async () => {
    const doc = baseDoc({ id: '6' });
    await renderResult(document.getElementById('r')!, doc, 'markdown', {
      getMarkdown: async () => { throw new Error('boom'); },
      getRendered: async () => '',
    });
    expect(document.body.textContent).toContain('Превью недоступно');
  });
});
