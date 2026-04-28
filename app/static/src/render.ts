/**
 * Cross-cutting render helpers: HQ gear indicator, HQ status chip, re-OCR entry-points.
 *
 * Maintenance notes:
 * - This module contains only lightweight DOM mutations — no business logic.
 * - renderHqIndicator: mutates the header right-side flex container
 *   (.flex.gap-2.items-center inside <header>).
 *   Call after boot and whenever settings change.
 * - renderHqStatusChip: mutates the statusbar row (first [data-statusbar-row]
 *   OR the statusbar container itself). Call after renderStatusBar.
 * - Re-OCR buttons are rendered inside renderDocuments (documents.ts) and the actions
 *   bar (index.html static markup + main.ts handler). This module does NOT own doc-list
 *   rendering — see documents.ts.
 * - All i18n via t() from i18n.ts. Never hard-code user-visible strings.
 * - No side effects at module load time.
 */

import { t } from './i18n';

/**
 * Insert (or update) a gear icon + HQ status dot into the header controls container.
 *
 * Target: the `<div class="flex gap-2 items-center">` that contains `#recognize-btn`.
 * Idempotent — existing `[data-hq-indicator]` is replaced on repeated calls.
 *
 * @param hqOn - whether High-quality mode is currently active
 */
export function renderHqIndicator(hqOn: boolean): void {
  // Find the right-side controls container in the header
  const header = document.querySelector('header');
  if (!header) return;
  const controls = header.querySelector<HTMLElement>('.flex.gap-2.items-center');
  if (!controls) return;

  // Remove existing indicator if any (idempotent)
  const existing = controls.querySelector('[data-hq-indicator]');
  if (existing) existing.remove();

  const dotClass = hqOn ? 'bg-success' : 'bg-text-faint';
  const indicator = document.createElement('div');
  indicator.dataset.hqIndicator = '';
  indicator.className = 'flex items-center gap-1';
  indicator.innerHTML = `
    <button data-action="open-settings" class="pill text-sm leading-none" title="${t('settings.title')}">⚙</button>
    <span data-hq-dot class="w-2 h-2 rounded-full ${dotClass}"></span>
  `;

  // Insert before the first child (recognize-btn area) so it appears on the left side of controls
  controls.insertBefore(indicator, controls.firstChild);
}

/**
 * Insert (or update) the HQ status chip inside the statusbar.
 *
 * Target: the first `[data-statusbar-row]` element inside the statusbar container,
 * or the statusbar container itself as fallback. Idempotent — existing `[data-hq-chip]` is replaced.
 *
 * @param hqOn       - whether High-quality mode is active
 * @param modelCount - number of optional sub-models enabled (relevant when hqOn=true)
 */
export function renderHqStatusChip(hqOn: boolean, modelCount: number): void {
  const statusbar = document.getElementById('statusbar');
  if (!statusbar) return;

  // Remove existing chip
  const existing = statusbar.querySelector('[data-hq-chip]');
  if (existing) existing.remove();

  const label = hqOn
    ? t('settings.indicator_on', { n: modelCount })
    : t('settings.indicator_off');

  const chip = document.createElement('span');
  chip.dataset.hqChip = '';
  chip.className = 'text-xs text-text-muted';
  chip.textContent = label;

  // Prefer the inner statusbar row element if present; fall back to container
  const row = statusbar.querySelector<HTMLElement>('[data-statusbar-row]') ?? statusbar.firstElementChild as HTMLElement | null;
  if (row) {
    row.insertBefore(chip, row.firstChild);
  } else {
    statusbar.appendChild(chip);
  }
}
