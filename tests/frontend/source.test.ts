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
  available_formats: ['md'], stage: null, stage_detail: null, stage_label: null,
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
    // Large page now uses URL (1-indexed), NOT base64
    expect(largeImg.getAttribute('src')).toBe('/api/preview/7p/page/2');
  });

  it('PDF: clamps selectedPageIdx to valid range', () => {
    const { thumbs, large } = setup();
    const doc = baseDoc({ id: '9p', filename: 'doc.pdf' });
    renderSourcePane(thumbs, large, doc, ['A', 'B'], 99);
    // idx clamped to 1 (last), page number = 2
    expect((large.querySelector('.source-large') as HTMLImageElement).getAttribute('src')).toBe('/api/preview/9p/page/2');
  });

  it('PDF: handles negative selectedPageIdx', () => {
    const { thumbs, large } = setup();
    const doc = baseDoc({ id: '9p', filename: 'doc.pdf' });
    renderSourcePane(thumbs, large, doc, ['A', 'B'], -5);
    // idx clamped to 0 (first), page number = 1
    expect((large.querySelector('.source-large') as HTMLImageElement).getAttribute('src')).toBe('/api/preview/9p/page/1');
  });

  it('large page uses /api/preview/{id}/page/{n} URL, not base64', () => {
    const thumbs = document.createElement('div');
    const large = document.createElement('div');
    const doc = { id: 'doc1', filename: 'x.pdf' } as any;
    renderSourcePane(thumbs, large, doc, ['THUMB1B64', 'THUMB2B64'], 1);
    const img = large.querySelector('img.source-large') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/preview/doc1/page/2');
  });

  it('thumbnails still use base64 (compact strip)', () => {
    const thumbs = document.createElement('div');
    const large = document.createElement('div');
    const doc = { id: 'doc1', filename: 'x.pdf' } as any;
    renderSourcePane(thumbs, large, doc, ['THUMB1B64', 'THUMB2B64'], 0);
    const thumbImgs = thumbs.querySelectorAll('img.source-thumb');
    expect(thumbImgs.length).toBe(2);
    expect(thumbImgs[0]!.getAttribute('src')).toBe('data:image/jpeg;base64,THUMB1B64');
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
