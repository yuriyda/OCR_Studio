/**
 * Render status bar at the bottom of the UI: engine state, environment, project statistics.
 *
 * Maintenance notes:
 * - No business logic here — only format data passed by the controller (main.ts).
 * - Project size is formatted via formatBytes from icons.ts.
 * - All strings via i18n: t('statusbar.*'), t('statusbar.docs_total').
 * - 'idle' engine status is shown with the same label as 'loading' — it is a transient
 *   state on first startup before receiving a response from /api/system.
 */

import { t } from './i18n';
import { formatBytes } from './icons';
import type { LangCode, PipelineModel } from './types';

export interface StatusBarData {
  env: { gpu: string | null; cuda: string | null; vram_gb: number | null };
  engine: {
    name: string;
    lang: LangCode | null;
    status: 'ready' | 'loading' | 'idle';
    pipeline: PipelineModel[];
  };
  project: { name: string; doc_count: number; total_bytes: number; processing: number; queued: number } | null;
}

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
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
  container.innerHTML = `
    <div class="flex items-center gap-4 text-xs text-text-muted px-3 py-1 bg-surface border-t border-border">
      <span data-engine title="${escHtml(tooltip)}">${engineLabel}</span>
      <span>${escHtml(env)}</span>
      <span>${cuda}</span>
      <span class="ml-auto">${escHtml(proj)}</span>
    </div>`;
}
