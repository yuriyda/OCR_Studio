/**
 * Thin wrapper around split.js for a resizable 3-pane layout (sidebar | source | result).
 *
 * Maintenance notes:
 * - sizes — % of total width; minSize — px. Restored from state.panelSizes
 *   and saved via the onResize callback in state.setPanelSizes() (called in main.ts).
 * - gutterSize=6 — narrow strip between panes. Styled via main.css.
 * - direction='horizontal' — resize by width. A separate init would be needed for vertical.
 * - cursor='col-resize' — browser shows the correct cursor on hover.
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
    onDragEnd: (newSizes: number[]) => onResize(newSizes),
  });
}
