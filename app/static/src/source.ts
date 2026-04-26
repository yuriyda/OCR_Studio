/**
 * Source pane: рендер исходного документа крупно (PDF страница или изображение).
 *
 * Редактирование:
 * - Для image — берём оригинал через /api/source/{id} (Task 11), не превью.
 * - Для PDF — берём страницу из preview b64 массива (preview API возвращает base64 JPEG страниц).
 * - selectedPageIdx clamped в [0, pages.length-1] — UI thumbnail-bar контролирует значение.
 * - Не делать fetch здесь — controller (main.ts) подгружает preview в кэш и передаёт.
 * - i18n строки приходят через t() из i18n.ts.
 */

import type { Document } from './types';
import { t } from './i18n';

const IMAGE_EXT = /\.(png|jpg|jpeg|bmp|tiff?|webp|gif)$/i;

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function renderSourcePane(
  container: HTMLElement,
  doc: Document | null,
  pages: string[] | null,
  selectedPageIdx: number,
): void {
  if (!doc) {
    container.innerHTML = `<div class="text-text-muted text-center py-10">${t('preview.source.empty')}</div>`;
    return;
  }
  if (IMAGE_EXT.test(doc.filename)) {
    container.innerHTML = `
      <div class="flex items-center justify-center h-full p-4">
        <img src="/api/source/${escHtml(doc.id)}" alt="${escHtml(doc.filename)}" class="source-large max-w-full max-h-full rounded border border-border bg-white" />
      </div>`;
    return;
  }
  if (pages && pages.length > 0) {
    const idx = Math.max(0, Math.min(selectedPageIdx, pages.length - 1));
    container.innerHTML = `
      <div class="flex items-center justify-center h-full p-4">
        <img src="data:image/jpeg;base64,${pages[idx]}" alt="page ${idx + 1}" class="source-large max-w-full max-h-full rounded border border-border bg-white" />
      </div>`;
    return;
  }
  container.innerHTML = `<div class="text-text-muted text-center py-10">${t('preview.unavailable')}</div>`;
}
