/**
 * Render status bar внизу UI: состояние движка, окружение, статистика проекта.
 *
 * Редактирование:
 * - Без бизнес-логики — только формат данных переданных controller'ом (main.ts).
 * - Размер проекта формируется через formatBytes из icons.ts.
 * - Все строки через i18n: t('statusbar.*'), t('statusbar.docs_total').
 * - 'idle' status engine показывается с тем же лейблом что 'loading' — это переходное
 *   состояние при первом запуске до получения ответа /api/system.
 */

import { t } from './i18n';
import { formatBytes } from './icons';
import type { LangCode } from './types';

export interface StatusBarData {
  env: { gpu: string | null; cuda: string | null; vram_gb: number | null };
  engine: { name: string; lang: LangCode | null; status: 'ready' | 'loading' | 'idle' };
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
  const envParts = [data.env.gpu, data.env.vram_gb !== null ? `${data.env.vram_gb} ГБ` : null]
    .filter(Boolean) as string[];
  const env = envParts.join(' · ');
  const cuda = data.env.cuda ? `CUDA ${escHtml(data.env.cuda)}` : '';
  const proj = data.project
    ? t('statusbar.docs_total', { count: data.project.doc_count, size: formatBytes(data.project.total_bytes) })
    : '';
  const lang = data.engine.lang ?? '—';

  container.innerHTML = `
    <div class="flex items-center gap-4 text-xs text-text-muted px-3 py-1 bg-surface border-t border-border">
      <span>${engineLabel} · ${escHtml(lang)}</span>
      <span>${escHtml(env)}</span>
      <span>${cuda}</span>
      <span class="ml-auto">${escHtml(proj)}</span>
    </div>`;
}
