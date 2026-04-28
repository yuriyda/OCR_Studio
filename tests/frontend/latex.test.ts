import { describe, it, expect } from 'vitest';
import { renderLatex } from '../../app/static/src/latex';

describe('renderLatex', () => {
  it('replaces $$x^2$$ with a katex span', () => {
    const div = document.createElement('div');
    div.innerHTML = 'before $$x^2$$ after';
    renderLatex(div);
    expect(div.querySelector('.katex')).not.toBeNull();
  });

  it('keeps surrounding text intact', () => {
    const div = document.createElement('div');
    div.innerHTML = 'before $$x^2$$ after';
    renderLatex(div);
    expect(div.textContent).toContain('before');
    expect(div.textContent).toContain('after');
  });

  it('handles invalid latex gracefully (does not throw)', () => {
    const div = document.createElement('div');
    div.innerHTML = '$$\\frac{ broken $$';
    expect(() => renderLatex(div)).not.toThrow();
  });

  it('renders multiple block formulas', () => {
    const div = document.createElement('div');
    div.innerHTML = '$$E = mc^2$$ middle $$\\int x dx$$';
    renderLatex(div);
    const renders = div.querySelectorAll('.katex');
    expect(renders.length).toBe(2);
  });
});
