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
  available_formats: ['md'],
  ...overrides,
});

const setup = (): { thumbs: HTMLElement; large: HTMLElement } => {
  document.body.innerHTML = '<div id="thumbs"></div><div id="large"></div>';
  return {
    thumbs: document.getElementById('thumbs')!,
    large: document.getElementById('large')!,
  };
};

describe('renderSourcePane', () => {
  beforeEach(() => loadLang('ru'));

  it('shows empty state when no doc', () => {
    const { thumbs, large } = setup();
    renderSourcePane(thumbs, large, null, null, 0);
    expect(large.textContent).toContain('Выберите документ');
    expect(thumbs.style.display).toBe('none');
  });

  it('renders image via /api/source for png — no thumbs', () => {
    const { thumbs, large } = setup();
    const doc = baseDoc({ id: '5x', filename: 'photo.png' });
    renderSourcePane(thumbs, large, doc, null, 0);
    const img = large.querySelector('.source-large') as HTMLImageElement;
    expect(img?.getAttribute('src')).toBe('/api/source/5x');
    expect(thumbs.style.display).toBe('none');
  });

  it('renders image via /api/source for JPG (case-insensitive)', () => {
    const { thumbs, large } = setup();
    const doc = baseDoc({ id: 'j1', filename: 'a.JPG' });
    renderSourcePane(thumbs, large, doc, null, 0);
    expect(large.querySelector('.source-large')?.getAttribute('src')).toBe('/api/source/j1');
  });

  it('PDF: renders thumbnail strip + large page at selected idx', () => {
    const { thumbs, large } = setup();
    const doc = baseDoc({ id: '7p', filename: 'doc.pdf' });
    renderSourcePane(thumbs, large, doc, ['BASE64A', 'BASE64B', 'BASE64C'], 1);
    expect(thumbs.style.display).toBe('block');
    expect(thumbs.querySelectorAll('.source-thumb').length).toBe(3);
    const active = thumbs.querySelector('.thumb-page-active') as HTMLImageElement;
    expect(active?.dataset.pageIdx).toBe('1');
    const largeImg = large.querySelector('.source-large') as HTMLImageElement;
    expect(largeImg.src).toContain('BASE64B');
  });

  it('PDF: clamps selectedPageIdx to valid range', () => {
    const { thumbs, large } = setup();
    const doc = baseDoc({ id: '9p', filename: 'doc.pdf' });
    renderSourcePane(thumbs, large, doc, ['A', 'B'], 99);
    expect((large.querySelector('.source-large') as HTMLImageElement).src).toContain('B');
  });

  it('PDF: handles negative selectedPageIdx', () => {
    const { thumbs, large } = setup();
    const doc = baseDoc({ id: '9p', filename: 'doc.pdf' });
    renderSourcePane(thumbs, large, doc, ['A', 'B'], -5);
    expect((large.querySelector('.source-large') as HTMLImageElement).src).toContain('A');
  });

  it('PDF: shows preview.unavailable when pages is empty', () => {
    const { thumbs, large } = setup();
    const doc = baseDoc({ id: '9p', filename: 'doc.pdf' });
    renderSourcePane(thumbs, large, doc, [], 0);
    expect(large.textContent).toContain('Превью недоступно');
    expect(thumbs.style.display).toBe('none');
  });

  it('PDF: shows preview.unavailable when pages is null', () => {
    const { thumbs, large } = setup();
    const doc = baseDoc({ id: '9p', filename: 'doc.pdf' });
    renderSourcePane(thumbs, large, doc, null, 0);
    expect(large.textContent).toContain('Превью недоступно');
  });

  it('PDF: thumbnails have data-page-idx for click delegation', () => {
    const { thumbs, large } = setup();
    const doc = baseDoc({ id: '9p', filename: 'doc.pdf' });
    renderSourcePane(thumbs, large, doc, ['A', 'B', 'C'], 0);
    const items = Array.from(thumbs.querySelectorAll<HTMLImageElement>('.source-thumb'));
    expect(items.map(t => t.dataset.pageIdx)).toEqual(['0', '1', '2']);
  });
});
