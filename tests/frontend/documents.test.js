import { describe, it, expect, beforeEach } from 'vitest';
import { renderDocuments, applySort } from '../../app/static/js/documents.js';

describe('documents', () => {
  let container;
  beforeEach(() => {
    document.body.innerHTML = '<div id="docs"></div>';
    container = document.getElementById('docs');
  });

  it('renders empty state when no docs', () => {
    renderDocuments(container, [], null);
    expect(container.textContent).toContain('Перетащите');
  });

  it('renders status icon and filename', () => {
    renderDocuments(container, [
      { id: 'a1', filename: 'x.pdf', status: 'done' },
    ], null);
    expect(container.textContent).toContain('x.pdf');
  });

  it('shows progress bar for processing with percent', () => {
    renderDocuments(container, [
      { id: 'a1', filename: 'x.pdf', status: 'processing', progress_percent: 60 },
    ], null);
    expect(container.querySelector('.progress-bar')).toBeTruthy();
  });

  it('shows indeterminate spinner for processing without percent', () => {
    renderDocuments(container, [
      { id: 'a1', filename: 'x.pdf', status: 'processing', progress_percent: null },
    ], null);
    expect(container.querySelector('.spinner')).toBeTruthy();
  });

  it('marks active doc', () => {
    renderDocuments(container, [
      { id: 'a1', filename: 'x.pdf', status: 'done' },
    ], 'a1');
    expect(container.querySelector('.doc-item.active')).toBeTruthy();
  });

  it('renders format badge for each doc', () => {
    renderDocuments(container, [
      { id: 'a1', filename: 'x.pdf', status: 'done', format: 'md' },
      { id: 'b2', filename: 'y.pdf', status: 'done', format: 'docx' },
    ], null);
    const badges = container.querySelectorAll('.format-badge');
    expect(badges.length).toBe(2);
    expect(badges[0].textContent).toBe('md');
    expect(badges[1].textContent).toBe('docx');
  });

  it('omits format badge when format is missing', () => {
    renderDocuments(container, [
      { id: 'a1', filename: 'x.pdf', status: 'done' },
    ], null);
    expect(container.querySelectorAll('.format-badge').length).toBe(0);
  });

  it('shows elapsed time and page counter for processing doc', () => {
    renderDocuments(container, [
      { id: 'a1', filename: 'x.pdf', status: 'processing', progress_percent: 50, current_page: 5, page_count: 10, elapsed_seconds: 65, eta_seconds: 65 },
    ], null);
    expect(container.textContent).toMatch(/1:05/);
    expect(container.textContent).toContain('5/10');
  });
});

describe('documents.applySort', () => {
  const docs = [
    { id: 'a', filename: 'b.pdf', size_bytes: 100, created_at: '2026-04-01T00:00:00+00:00' },
    { id: 'b', filename: 'a.pdf', size_bytes: 200, created_at: '2026-04-02T00:00:00+00:00' },
  ];

  it('sort by name asc', () => {
    expect(applySort(docs, 'name', 'asc').map(d => d.filename)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('sort by name desc', () => {
    expect(applySort(docs, 'name', 'desc').map(d => d.filename)).toEqual(['b.pdf', 'a.pdf']);
  });

  it('sort by size desc', () => {
    expect(applySort(docs, 'size', 'desc').map(d => d.id)).toEqual(['b', 'a']);
  });

  it('sort by created desc', () => {
    expect(applySort(docs, 'created', 'desc').map(d => d.id)).toEqual(['b', 'a']);
  });
});
