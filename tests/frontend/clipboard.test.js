import { describe, it, expect, vi } from 'vitest';
import { getCopyText } from '../../app/static/js/clipboard.js';

describe('clipboard.getCopyText', () => {
  it('returns markdown raw for md format', async () => {
    const api = { getMarkdown: vi.fn().mockResolvedValue({ markdown: '# Title\n\ntext' }) };
    const text = await getCopyText({ id: 'a', format: 'md' }, api);
    expect(text).toBe('# Title\n\ntext');
    expect(api.getMarkdown).toHaveBeenCalledWith('a');
  });

  it('returns markdown raw for txt format', async () => {
    const api = { getMarkdown: vi.fn().mockResolvedValue({ markdown: 'plain' }) };
    const text = await getCopyText({ id: 'a', format: 'txt' }, api);
    expect(text).toBe('plain');
  });

  it('strips html tags but preserves newlines for docx', async () => {
    const api = { getRendered: vi.fn().mockResolvedValue({ html: '<h1>Title</h1><p>один</p><p>два</p>' }) };
    const text = await getCopyText({ id: 'a', format: 'docx' }, api);
    expect(text).toContain('Title');
    expect(text).toContain('один');
    expect(text).toContain('два');
    // Между параграфами должны быть переносы — НЕ "одиндва"
    expect(text).not.toContain('одиндва');
  });

  it('preserves table structure for docx with tabs', async () => {
    const api = { getRendered: vi.fn().mockResolvedValue({
      html: '<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>',
    })};
    const text = await getCopyText({ id: 'a', format: 'docx' }, api);
    expect(text).toContain('A');
    expect(text).toContain('B');
    expect(text).toMatch(/A\s+B/);
    expect(text).toMatch(/1\s+2/);
  });

  it('returns empty string for null doc', async () => {
    expect(await getCopyText(null, {})).toBe('');
  });

  it('handles missing markdown gracefully', async () => {
    const api = { getMarkdown: vi.fn().mockResolvedValue({}) };
    const text = await getCopyText({ id: 'a', format: 'md' }, api);
    expect(text).toBe('');
  });
});
