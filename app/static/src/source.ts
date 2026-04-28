/**
 * Source pane: renders the original document.
 *
 * Layout: [thumbnail strip left ~88px] [large page right].
 * - Image: strip hidden, large = <img src="/api/source/{id}">.
 * - PDF + pages: strip with thumbnails for all pages (base64 jpeg),
 *   large = <img src="/api/preview/{id}/page/{n}"> — backend serves full-res JPG
 *   from disk (preview_render.render_page), browser caches it (Cache-Control max-age=3600).
 *   Active thumbnail highlighted with `.thumb-page-active`.
 *   Click handler is bound in main.ts (event delegation on #source-thumbs).
 * - PDF without pages → strip hidden, large = preview.unavailable.
 *
 * Maintenance notes:
 * - Do not fetch here — the controller (main.ts) loads preview into the cache.
 * - selectedPageIdx is clamped to [0, pages.length-1].
 * - Large page is NEVER built from base64 — URL only. Thumbnails use base64 (compact strip).
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
    // Large — direct URL: browser fetches + cache-control applies. base64 in JSON would cost
    // an extra megabyte per click. Backend serves from disk via preview_render.render_page.
    largeContainer.innerHTML = `<img src="/api/preview/${escHtml(doc.id)}/page/${idx + 1}" alt="page ${idx + 1}" class="source-large max-w-full max-h-full rounded border border-border bg-white" />`;
    return;
  }
  thumbsContainer.style.display = 'none';
  thumbsContainer.innerHTML = '';
  largeContainer.innerHTML = `<div class="text-text-muted text-center py-10">${t('preview.unavailable')}</div>`;
}
