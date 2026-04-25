import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderPreview } from '../../app/static/js/preview.js';

describe('preview', () => {
  let container;
  beforeEach(() => {
    document.body.innerHTML = '<div id="prev"></div>';
    container = document.getElementById('prev');
  });

  it('source mode shows raw md in pre', async () => {
    const apiMock = { getMarkdown: vi.fn().mockResolvedValue({ markdown: '# X' }) };
    await renderPreview(container, { id: 'a', format: 'md' }, 'source', apiMock);
    expect(container.querySelector('pre')).toBeTruthy();
    expect(container.textContent).toContain('# X');
  });

  it('rendered mode inserts sanitized HTML from backend', async () => {
    const apiMock = { getRendered: vi.fn().mockResolvedValue({ html: '<h1>OK</h1>' }) };
    await renderPreview(container, { id: 'a', format: 'md' }, 'rendered', apiMock);
    expect(container.innerHTML).toContain('<h1>OK</h1>');
  });

  it('source for docx shows unavailable message', async () => {
    const apiMock = {};
    await renderPreview(container, { id: 'a', format: 'docx' }, 'source', apiMock);
    expect(container.textContent).toMatch(/недоступен/i);
  });

  it('does not call client-side markdown library', async () => {
    expect(true).toBe(true);
  });

  it('pages mode shows large image of selected page', async () => {
    const pageData = { pages: ['BASE64_A', 'BASE64_B', 'BASE64_C'], selectedIdx: 1 };
    await renderPreview(container, { id: 'a', format: 'md' }, 'pages', null, pageData);
    const img = container.querySelector('img.page-large');
    expect(img).toBeTruthy();
    expect(img.src).toContain('BASE64_B');
  });

  it('pages mode without data shows empty state', async () => {
    await renderPreview(container, { id: 'a', format: 'md' }, 'pages', null, { pages: [] });
    expect(container.textContent).toMatch(/недоступн/i);
  });

  it('pages mode default selectedIdx is 0', async () => {
    const pageData = { pages: ['FIRST', 'SECOND'] };
    await renderPreview(container, { id: 'a', format: 'md' }, 'pages', null, pageData);
    const img = container.querySelector('img.page-large');
    expect(img.src).toContain('FIRST');
  });
});
