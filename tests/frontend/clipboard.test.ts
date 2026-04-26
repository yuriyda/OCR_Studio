import { describe, it, expect, vi } from 'vitest';
import { htmlToPlainText, getCopyText } from '../../app/static/src/clipboard';

describe('htmlToPlainText', () => {
  it('inserts newline between blocks', () => {
    expect(htmlToPlainText('<p>line 1</p><p>line 2</p>')).toContain('line 1\n');
  });
  it('uses tabs between table cells', () => {
    expect(htmlToPlainText('<table><tr><td>A</td><td>B</td></tr></table>')).toContain('A\tB');
  });
  it('handles plain text', () => {
    expect(htmlToPlainText('hello world')).toBe('hello world');
  });
  it('strips trailing whitespace', () => {
    expect(htmlToPlainText('<p>x</p>').endsWith('x')).toBe(true);
  });
});

describe('getCopyText', () => {
  const apiClient = {
    getMarkdown: vi.fn().mockResolvedValue('# md content'),
    getRendered: vi.fn().mockResolvedValue('<h1>Doc</h1>'),
  };
  it('returns empty for undefined doc', async () => {
    expect(await getCopyText(undefined, apiClient)).toBe('');
  });
  it('returns markdown for md format', async () => {
    const r = await getCopyText({ id: 'a', format: 'md' }, apiClient);
    expect(r).toBe('# md content');
  });
  it('returns plain text from rendered HTML for docx', async () => {
    const r = await getCopyText({ id: 'b', format: 'docx' }, apiClient);
    expect(r).toContain('Doc');
  });
});
