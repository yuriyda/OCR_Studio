/**
 * Source pane: рендер исходного документа.
 *
 * Структура: [thumbnail strip слева ~88px] [large page справа].
 * - Image: strip скрыт, large = <img src="/api/source/{id}">.
 * - PDF + pages: strip с миниатюрами всех страниц (base64 jpeg),
 *   large = <img src="/api/preview/{id}/page/{n}"> — backend отдаёт full-res JPG
 *   с диска (preview_render.render_page), браузер кэширует (Cache-Control max-age=3600).
 *   Активная миниатюра подсвечена `.thumb-page-active`.
 *   Click handler привязан в main.ts (event delegation на #source-thumbs).
 * - PDF без pages → strip скрыт, large = preview.unavailable.
 *
 * Редактирование:
 * - Не делать fetch здесь — controller (main.ts) подгружает preview в кэш.
 * - selectedPageIdx clamped в [0, pages.length-1].
 * - Large page НИКОГДА не строится из base64 — только URL. Thumbnails — base64 (компактная полоса).
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
  thumbsContainer: HTMLElement,
  largeContainer: HTMLElement,
  doc: Document | null,
  pages: string[] | null,
  selectedPageIdx: number,
): void {
  if (!doc) {
    thumbsContainer.style.display = 'none';
    thumbsContainer.innerHTML = '';
    largeContainer.innerHTML = `<div class="text-text-muted text-center py-10">${t('preview.source.empty')}</div>`;
    return;
  }
  if (IMAGE_EXT.test(doc.filename)) {
    thumbsContainer.style.display = 'none';
    thumbsContainer.innerHTML = '';
    largeContainer.innerHTML = `<img src="/api/source/${escHtml(doc.id)}" alt="${escHtml(doc.filename)}" class="source-large max-w-full max-h-full rounded border border-border bg-white" />`;
    return;
  }
  // PDF
  if (pages && pages.length > 0) {
    const idx = Math.max(0, Math.min(selectedPageIdx, pages.length - 1));
    thumbsContainer.style.display = 'block';
    thumbsContainer.innerHTML = pages.map((b64, i) => {
      const active = i === idx ? 'thumb-page-active' : '';
      return `<img class="source-thumb ${active}" data-page-idx="${i}" src="data:image/jpeg;base64,${b64}" alt="page ${i + 1}" />`;
    }).join('');
    // Large — direct URL: browser догружает + кэш-control. base64 в JSON был бы лишним
    // мегабайтом для каждого клика. Backend обслуживает с диска через preview_render.render_page.
    largeContainer.innerHTML = `<img src="/api/preview/${escHtml(doc.id)}/page/${idx + 1}" alt="page ${idx + 1}" class="source-large max-w-full max-h-full rounded border border-border bg-white" />`;
    return;
  }
  thumbsContainer.style.display = 'none';
  thumbsContainer.innerHTML = '';
  largeContainer.innerHTML = `<div class="text-text-muted text-center py-10">${t('preview.unavailable')}</div>`;
}
