/**
 * Тонкая обёртка над split.js для resizable 3-pane layout (sidebar | source | result).
 *
 * Редактирование:
 * - Размеры (sizes) — % ширины, минимумы (minSize) — px. Восстанавливаются из state.panelSizes
 *   и сохраняются через onResize callback в state.setPanelSizes() (вызов в main.ts).
 * - gutterSize=6 — узкая полоска между панелями. Стилизуется через main.css.
 * - direction='horizontal' — резайз по ширине. Для вертикали будет отдельный init.
 * - cursor='col-resize' — браузер показывает правильный курсор при hover.
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
