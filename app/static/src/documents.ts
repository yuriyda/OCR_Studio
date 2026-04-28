/**
 * Render the document list in the sidebar.
 *
 * Maintenance notes:
 * - File type icon — via `iconForFilename` (icons.ts).
 * - Size — via `formatBytes` (icons.ts).
 * - States:
 *   - queued / done / error → badge .badge-{state} with i18n label.
 *   - processing → progress bar (.progress-fill, width = progress_percent) + "page N/M" counter.
 * - error_message (available for error documents) shown in the badge title.
 * - Document.id is a string. activeId is compared as a string; null is valid.
 * - Do not attach click handlers here; delegate via main.ts.
 * - applySort: pure function, returns a new array, does not mutate.
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
  // stage_label from the backend takes priority over the page counter
  const label = d.stage_label ?? (tot ? `${cur}/${tot}` : '');
  const counter = label
    ? `<span class="text-xs text-text-muted">${escHtml(label)}</span>`
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
