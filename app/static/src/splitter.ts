/**
 * Thin wrapper around split.js for a resizable 3-pane layout (sidebar | source | result).
 *
 * Maintenance notes:
 * - sizes — % of total width; minSize — px. Restored from state.panelSizes
 *   and saved via the onResize callback in state.setPanelSizes() (called in main.ts).
 * - gutterSize=6 — narrow strip between panes. Styled via main.css.
 * - direction='horizontal' — resize by width. A separate init would be needed for vertical.
 * - cursor='col-resize' — browser shows the correct cursor on hover.
 * - body.splitting toggle — main.css uses it to hide pane content during drag.
 *   For huge markdown (300+ pages) repaint dominates the main thread (DevTools
 *   shows 5+ s of Painting). Hiding content via visibility:hidden cuts paint
 *   to ~zero while drag is in progress; one repaint happens on release.
 */

import Split from 'split.js';

export type SplitInstance = ReturnType<typeof Split>;

export function initSplitter(
  elements: HTMLElement[],
  sizes: number[],
  onResize: (sizes: number[]) => void,
): SplitInstance {
  return Split(elements, {
    sizes,
    minSize: [200, 250, 280],
    gutterSize: 6,
    direction: 'horizontal',
    cursor: 'col-resize',
    onDragStart: () => document.body.classList.add('splitting'),
    onDragEnd: (newSizes: number[]) => {
      document.body.classList.remove('splitting');
      onResize(newSizes);
    },
  });
}
