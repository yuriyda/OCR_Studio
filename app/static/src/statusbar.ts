/**
 * Render status bar at the bottom of the UI: engine state, environment, project statistics,
 * and active OCR queue progress.
 *
 * Maintenance notes:
 * - No business logic — only format data passed by main.ts.
 * - Layout is responsive: a second progress row appears ABOVE the engine row only when
 *   `queue.active === true`. In idle mode, an inline "last batch" tail is appended to
 *   the engine row if `queue.lastSummary` is present.
 * - All user-facing strings via i18n: `statusbar.*`, `units.*`. Queue-specific keys live
 *   under `statusbar.queue.*` (added in Task 4 / pre-seeded in Task 3).
 * - `idle` engine status is rendered with the loading label — it is a transient state
 *   on first boot before /api/system returns.
 * - `formatDuration` is exported for unit testing; it is a pure function with no side effects.
 */

import { t } from './i18n';
import { formatBytes } from './icons';
import type { LangCode, PipelineModel } from './types';

export interface StatusBarQueue {
  /** True when at least one document is being actively processed. */
  active: boolean;
  /** Documents completed in the current batch (since the batch started). */
  completedInBatch: number;
  /** Total documents in the current batch (queued + processing + done). */
  totalInBatch: number;
  /** Number of documents currently in processing state right now. */
  activeNow: number;
  /** Elapsed wall-clock time for the current batch, in milliseconds. */
  elapsedMs: number;
  /** Estimated remaining time in milliseconds, or null if not yet computable. */
  etaMs: number | null;
  /** Summary of the last completed batch, shown in idle state as a tail label. */
  lastSummary: { total: number; elapsedMs: number } | null;
  /** Currently processing document, or null if idle or unknown. */
  current: { filename: string; size_bytes: number } | null;
}

export interface StatusBarData {
  env: { gpu: string | null; cuda: string | null; vram_gb: number | null };
  engine: {
    name: string;
    lang: LangCode | null;
    status: 'ready' | 'loading' | 'idle';
    pipeline: PipelineModel[];
  };
  project: { name: string; doc_count: number; total_bytes: number; processing: number; queued: number } | null;
  queue: StatusBarQueue;
}

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/**
 * Format a duration in milliseconds as a human-readable string.
 * - Under 60 s: "Ns"
 * - Under 1 h: "M:SS"
 * - 1 h+: "H:MM:SS"
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Build the active queue progress row HTML (only when queue.active is true). */
function renderQueueRow(q: StatusBarQueue): string {
  const total = q.totalInBatch > 0 ? q.totalInBatch : 1;
  const pct = Math.min(100, Math.max(0, Math.round((q.completedInBatch / total) * 100)));
  const parts: string[] = [];
  parts.push(`${q.completedInBatch} / ${q.totalInBatch}`);
  parts.push(t('statusbar.queue.queue_size', { count: q.activeNow }));
  parts.push(t('statusbar.queue.elapsed', { duration: formatDuration(q.elapsedMs) }));
  if (q.etaMs !== null && q.completedInBatch > 0) {
    parts.push(t('statusbar.queue.eta', { duration: formatDuration(q.etaMs) }));
  }
  if (q.current !== null) {
    parts.push(`${q.current.filename} (${formatBytes(q.current.size_bytes)})`);
  }
  const text = parts.join(' · ');
  return `
    <div data-queue-row class="flex items-center gap-3 text-xs text-text-muted px-3 py-1 bg-surface border-t border-border">
      <div class="flex-1 h-2 bg-border rounded overflow-hidden">
        <div data-queue-fill class="h-full bg-accent" style="width: ${pct}%"></div>
      </div>
      <span class="whitespace-nowrap">${escHtml(text)}</span>
    </div>`;
}

export function renderStatusBar(container: HTMLElement, data: StatusBarData): void {
  const engineLabel = data.engine.status === 'loading' || data.engine.status === 'idle'
    ? t('statusbar.engine_loading')
    : t('statusbar.engine_ready');
  const envParts = [data.env.gpu, data.env.vram_gb !== null ? `${data.env.vram_gb} ${t('units.gb')}` : null]
    .filter(Boolean) as string[];
  const env = envParts.join(' · ');
  const cuda = data.env.cuda ? `CUDA ${escHtml(data.env.cuda)}` : '';
  const proj = data.project
    ? t('statusbar.docs_total', { count: data.project.doc_count, size: formatBytes(data.project.total_bytes) })
    : '';

  // engine.lang is intentionally not rendered — it is the OCR engine language (cyrillic), not the UI locale.
  // Previously displayed as "· ru" which confused users. Tooltip with pipeline models
  // is kept — it provides the needed info on hover.
  const tooltip = data.engine.pipeline.map(m => `${m.role}: ${m.name}`).join('\n');

  const queueRowHtml = data.queue.active ? renderQueueRow(data.queue) : '';

  const lastSummaryHtml = !data.queue.active && data.queue.lastSummary
    ? `<span data-queue-last-summary class="ml-2">${escHtml(' · ' + t('statusbar.queue.last_batch', { count: data.queue.lastSummary.total, duration: formatDuration(data.queue.lastSummary.elapsedMs) }))}</span>`
    : '';

  container.innerHTML = `
    ${queueRowHtml}
    <div class="flex items-center gap-4 text-xs text-text-muted px-3 py-1 bg-surface border-t border-border">
      <span data-engine title="${escHtml(tooltip)}">${engineLabel}</span>
      <span>${escHtml(env)}</span>
      <span>${cuda}</span>
      <span class="ml-auto">${escHtml(proj)}${lastSummaryHtml}</span>
    </div>`;
}
