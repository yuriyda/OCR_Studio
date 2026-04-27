import { describe, it, expect, beforeEach } from 'vitest';
import { renderDocuments, applySort } from '../../app/static/src/documents';
import type { Document } from '../../app/static/src/types';
import { loadLang } from '../../app/static/src/i18n';

const docs: Document[] = [
  { id: 'a1', project_id: 1, filename: 'a.pdf', size_bytes: 1500, format: 'md', lang: 'ru', status: 'done',
    created_at: '2026-04-26T00:00:00', started_at: null, finished_at: null,
    page_count: null, current_page: null, progress_percent: null, elapsed_seconds: null, eta_seconds: null,
    error: null, available_formats: ['md'], stage: null, stage_label: null },
  { id: 'b2', project_id: 1, filename: 'b.png', size_bytes: 500_000, format: 'md', lang: 'ru', status: 'queued',
    created_at: '2026-04-26T00:00:01', started_at: null, finished_at: null,
    page_count: null, current_page: null, progress_percent: null, elapsed_seconds: null, eta_seconds: null,
    error: null, available_formats: [], stage: null, stage_label: null },
  { id: 'c3', project_id: 1, filename: 'c.pdf', size_bytes: 2_000_000, format: 'md', lang: 'ru', status: 'processing',
    created_at: '2026-04-26T00:00:02', started_at: '2026-04-26T00:00:03', finished_at: null,
    current_page: 5, page_count: 12, progress_percent: 41.6, elapsed_seconds: 30, eta_seconds: 42,
    error: null, available_formats: [], stage: 'ocr', stage_label: 'OCR страница 5/12' },
  { id: 'd4', project_id: 1, filename: 'd.tiff', size_bytes: 800_000, format: 'md', lang: 'ru', status: 'error',
    created_at: '2026-04-26T00:00:03', started_at: null, finished_at: null,
    page_count: null, current_page: null, progress_percent: null, elapsed_seconds: null, eta_seconds: null,
    error: 'OCR failed: bad scan', available_formats: [], stage: null, stage_label: null },
];

describe('renderDocuments', () => {
  beforeEach(() => { loadLang('ru'); document.body.innerHTML = '<div id="c"></div>'; });

  it('renders icons by extension', () => {
    const c = document.getElementById('c')!;
    renderDocuments(c, docs, null);
    expect(c.textContent).toContain('📕');
    expect(c.textContent).toContain('🖼');
  });

  it('renders sizes', () => {
    const c = document.getElementById('c')!;
    renderDocuments(c, docs, null);
    expect(c.textContent).toContain('1.5 КБ');
    expect(c.textContent).toContain('488.3 КБ');
  });

  it('renders queued badge', () => {
    const c = document.getElementById('c')!;
    renderDocuments(c, docs, null);
    expect(c.querySelector('.badge-queued')).toBeTruthy();
  });

  it('renders progress bar for processing with width based on percent', () => {
    const c = document.getElementById('c')!;
    renderDocuments(c, docs, null);
    const fill = c.querySelector('.progress-fill') as HTMLElement;
    expect(fill).toBeTruthy();
    expect(fill.style.width).toMatch(/4[0-2]%/);  // ~41.6 → "42%"
  });

  it('renders error badge with error message in title', () => {
    const c = document.getElementById('c')!;
    renderDocuments(c, docs, null);
    const badge = c.querySelector('.badge-error') as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.title).toContain('bad scan');
  });

  it('marks active document by string id', () => {
    const c = document.getElementById('c')!;
    renderDocuments(c, docs, 'b2');
    expect(c.querySelector('[data-id="b2"]')?.classList.contains('active')).toBe(true);
  });

  it('marks active document handles null', () => {
    const c = document.getElementById('c')!;
    renderDocuments(c, docs, null);
    expect(c.querySelectorAll('.doc-item.active').length).toBe(0);
  });

  it('escapes XSS in filename', () => {
    const c = document.getElementById('c')!;
    renderDocuments(c, [{
      id: 'x', project_id: 1, filename: '<script>alert(1)</script>',
      size_bytes: 0, format: 'md', lang: 'ru', status: 'queued',
      created_at: 'x', started_at: null, finished_at: null,
      page_count: null, current_page: null, progress_percent: null, elapsed_seconds: null, eta_seconds: null,
      error: null, available_formats: [], stage: null, stage_label: null,
    }], null);
    expect(c.innerHTML).not.toContain('<script>');
    expect(c.innerHTML).toContain('&lt;script&gt;');
  });

  it('applySort by name asc', () => {
    const sorted = applySort(docs, 'name', 'asc');
    expect(sorted.map(d => d.filename)).toEqual(['a.pdf', 'b.png', 'c.pdf', 'd.tiff']);
  });

  it('applySort by size desc', () => {
    const sorted = applySort(docs, 'size', 'desc');
    expect(sorted[0]?.id).toBe('c3');
  });

  it('applySort by created desc (default)', () => {
    const sorted = applySort(docs, 'created', 'desc');
    expect(sorted[0]?.id).toBe('d4');
  });
});
