/**
 * Render списка документов в sidebar.
 *
 * Редактирование:
 * - Иконка типа файла — через `iconForFilename` (icons.ts).
 * - Размер — через `formatBytes` (icons.ts).
 * - Состояния:
 *   - queued / done / error → бейдж .badge-{state} с i18n-меткой.
 *   - processing → progress-bar (.progress-fill, ширина = progress_percent) + счётчик "стр N/M".
 * - error_message (доступен для error-документов) показывается в title бейджа.
 * - Document.id — string. activeId сравнивается строкой; null допустимо.
 * - Не навешивать click-обработчики здесь; делегирование в main.ts.
 * - applySort: чистая ф-я, возвращает новый массив, не мутирует.
 */

import type { Document } from './types';
import { iconForFilename, formatBytes } from './icons';
import { t } from './i18n';

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function progressMarkup(d: Document): string {
  if (d.status === 'queued') {
    return `<span class="badge badge-queued ml-auto">${t('doc.status.queued')}</span>`;
  }
  if (d.status === 'done') {
    return `<span class="badge badge-done ml-auto">${t('doc.status.done')}</span>`;
  }
  if (d.status === 'error') {
    const msg = d.error ?? '';
    return `<span class="badge badge-error ml-auto" title="${escHtml(msg)}">${t('doc.status.error')}</span>`;
  }
  // processing
  const cur = d.current_page ?? 0;
  const tot = d.page_count ?? 0;
  const pct = Math.max(0, Math.min(100, d.progress_percent ?? 0));
  const counter = tot
    ? `<span class="text-xs text-text-muted">${cur}/${tot}</span>`
    : '';
  return `
    ${counter}
    <div class="ml-auto w-20 h-1 bg-surface rounded overflow-hidden">
      <div class="progress-fill" style="width:${pct.toFixed(0)}%"></div>
    </div>`;
}

export function renderDocuments(
  container: HTMLElement,
  docs: Document[],
  activeId: string | null,
): void {
  container.innerHTML = docs.map((d) => {
    const active = activeId !== null && activeId === d.id ? 'active' : '';
    const menuClass = d.status === 'processing'
      ? 'doc-menu cursor-pointer text-text-muted px-1 disabled opacity-30'
      : 'doc-menu cursor-pointer text-text-muted px-1';
    return `
      <div class="doc-item ${active}" data-id="${escHtml(d.id)}" draggable="true">
        <span>${iconForFilename(d.filename)}</span>
        <span class="flex-1 truncate">${escHtml(d.filename)}</span>
        <span class="text-xs text-text-muted whitespace-nowrap">${formatBytes(d.size_bytes)}</span>
        ${progressMarkup(d)}
        <span class="${menuClass}">⋯</span>
      </div>`;
  }).join('');
}

export function applySort(docs: Document[], sort: string, order: string): Document[] {
  const sorted = [...docs];
  const dir = order === 'asc' ? 1 : -1;
  sorted.sort((a, b) => {
    if (sort === 'name') return a.filename.localeCompare(b.filename) * dir;
    if (sort === 'size') return (a.size_bytes - b.size_bytes) * dir;
    return a.created_at.localeCompare(b.created_at) * dir;
  });
  return sorted;
}
