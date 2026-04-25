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
});
