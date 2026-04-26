import { describe, it, expect, beforeEach } from 'vitest';
import { renderSourcePane } from '../../app/static/src/source';
import type { Document } from '../../app/static/src/types';
import { loadLang } from '../../app/static/src/i18n';

const baseDoc = (overrides: Partial<Document>): Document => ({
  id: 'a1', project_id: 1, filename: 'x.pdf', size_bytes: 100,
  format: 'md', lang: 'ru', status: 'done',
  created_at: 'x', started_at: null, finished_at: null,
  page_count: null, current_page: null, progress_percent: null,
  elapsed_seconds: null, eta_seconds: null, error: null,
  ...overrides,
});

describe('renderSourcePane', () => {
  beforeEach(() => { loadLang('ru'); document.body.innerHTML = '<div id="src"></div>'; });

  it('shows empty state when no doc', () => {
    renderSourcePane(document.getElementById('src')!, null, null, 0);
    expect(document.body.textContent).toContain('Выберите документ');
  });

  it('renders image via /api/source for png', () => {
    const doc = baseDoc({ id: '5x', filename: 'photo.png' });
    renderSourcePane(document.getElementById('src')!, doc, null, 0);
    const img = document.querySelector('.source-large') as HTMLImageElement;
    expect(img?.getAttribute('src')).toBe('/api/source/5x');
  });

  it('renders image via /api/source for JPG (case-insensitive)', () => {
    const doc = baseDoc({ id: 'j1', filename: 'a.JPG' });
    renderSourcePane(document.getElementById('src')!, doc, null, 0);
    expect(document.querySelector('.source-large')?.getAttribute('src')).toBe('/api/source/j1');
  });

  it('renders pdf page from preview b64 at selected idx', () => {
    const doc = baseDoc({ id: '7p', filename: 'doc.pdf' });
    renderSourcePane(document.getElementById('src')!, doc, ['BASE64A', 'BASE64B', 'BASE64C'], 1);
    const img = document.querySelector('.source-large') as HTMLImageElement;
    expect(img.src).toContain('BASE64B');
  });

  it('clamps selectedPageIdx to valid range', () => {
    const doc = baseDoc({ id: '9p', filename: 'doc.pdf' });
    renderSourcePane(document.getElementById('src')!, doc, ['A', 'B'], 99);
    expect((document.querySelector('.source-large') as HTMLImageElement).src).toContain('B');
  });

  it('handles negative selectedPageIdx', () => {
    const doc = baseDoc({ id: '9p', filename: 'doc.pdf' });
    renderSourcePane(document.getElementById('src')!, doc, ['A', 'B'], -5);
    expect((document.querySelector('.source-large') as HTMLImageElement).src).toContain('A');
  });

  it('shows preview.unavailable when PDF has no pages', () => {
    const doc = baseDoc({ id: '9p', filename: 'doc.pdf' });
    renderSourcePane(document.getElementById('src')!, doc, [], 0);
    expect(document.body.textContent).toContain('Превью недоступно');
  });

  it('shows preview.unavailable when PDF pages is null', () => {
    const doc = baseDoc({ id: '9p', filename: 'doc.pdf' });
    renderSourcePane(document.getElementById('src')!, doc, null, 0);
    expect(document.body.textContent).toContain('Превью недоступно');
  });
});
