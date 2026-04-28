/**
 * Client-side KaTeX rendering for OCR markdown output.
 *
 * Maintenance notes:
 * - Block delimiters only ($$...$$) — Paddle layout doesn't separate inline formulas.
 * - throwOnError: false — corrupt LaTeX is rendered as red text with a tooltip,
 *   never throws. Source LaTeX is preserved.
 * - Called from render.ts after innerHTML insert for format=md and format=docx.
 */
import renderMathInElement from 'katex/contrib/auto-render';

export function renderLatex(container: HTMLElement): void {
  renderMathInElement(container, {
    delimiters: [{ left: '$$', right: '$$', display: true }],
    throwOnError: false,
    errorColor: '#ff7a92',
  });
}
