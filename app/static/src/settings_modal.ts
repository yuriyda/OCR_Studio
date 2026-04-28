/**
 * Settings + Onboarding modal — shared component with two render modes.
 *
 * Maintenance notes:
 * - mode='onboarding' adds a welcome banner with GPU recommendation; same
 *   model cards / main switch as mode='settings'.
 * - On Apply: calls PUT /api/settings, then opens SSE stream to track reload.
 * - Apply is disabled if queueSize > 0 (passed in by caller).
 * - i18n keys live under settings.* and onboarding.* in i18n/{ru,en}.json.
 * - Named state imports (reset, getSettings, etc.) are convenience re-exports
 *   from state.ts — they delegate to the `state` object internally.
 */

import { t } from './i18n';
import { getSettings, getRecommendation, setSettings, setReloadProgress, clearReloadProgress } from './state';
import type { Recommendation } from './state';
import { putSettings, dismissOnboarding, streamReload } from './api';

interface ModelEntry {
  key: 'hq_orientation' | 'hq_unwarping' | 'hq_textline' | 'hq_chart' | 'hq_seal';
  titleKey: string;
  descKey: string;
  costKey: string;
}

const MODELS: ModelEntry[] = [
  { key: 'hq_orientation', titleKey: 'settings.hq.orientation_title', descKey: 'settings.hq.orientation_desc', costKey: 'settings.hq.orientation_cost' },
  { key: 'hq_unwarping',   titleKey: 'settings.hq.unwarping_title',   descKey: 'settings.hq.unwarping_desc',   costKey: 'settings.hq.unwarping_cost' },
  { key: 'hq_textline',    titleKey: 'settings.hq.textline_title',    descKey: 'settings.hq.textline_desc',    costKey: 'settings.hq.textline_cost' },
  { key: 'hq_chart',       titleKey: 'settings.hq.chart_title',       descKey: 'settings.hq.chart_desc',       costKey: 'settings.hq.chart_cost' },
  { key: 'hq_seal',        titleKey: 'settings.hq.seal_title',        descKey: 'settings.hq.seal_desc',        costKey: 'settings.hq.seal_cost' },
];

export interface SettingsModalOptions {
  mode: 'settings' | 'onboarding';
  queueSize?: number;
  onApplied?: () => void;
}

/** Open the settings/onboarding modal in the #modal-root container. */
export function openSettingsModal(opts: SettingsModalOptions): void {
  const settings = getSettings();
  const recommendation = getRecommendation();
  if (!settings) return;

  const root = document.getElementById('modal-root') ?? (() => {
    const r = document.createElement('div');
    r.id = 'modal-root';
    document.body.appendChild(r);
    return r;
  })();

  const queueSize = opts.queueSize ?? 0;
  const applyDisabled = queueSize > 0;

  const banner = opts.mode === 'onboarding' && recommendation
    ? `<div data-onboarding-banner class="mb-4 p-4 rounded glass-panel">
         <div class="font-bold mb-2">${t('onboarding.welcome')}</div>
         <div class="text-sm text-text-muted mb-2">${t('onboarding.recommendation_label')}</div>
         <div class="p-3 rounded bg-surface text-sm">
           <div class="font-mono">${recommendation.reason}</div>
           ${recommendation.warning ? `<div class="text-error mt-2">${recommendation.warning}</div>` : ''}
         </div>
       </div>`
    : '';

  const cardsHtml = MODELS.map((m) => `
    <label data-model-card class="block p-3 rounded glass-panel mb-2 cursor-pointer">
      <div class="flex items-start gap-2">
        <input type="checkbox" data-key="${m.key}" ${settings[m.key] ? 'checked' : ''} />
        <div>
          <div class="font-bold">${t(m.titleKey)}</div>
          <div class="text-sm text-text-muted">${t(m.descKey)}</div>
          <div class="text-xs text-text-faint mt-1">${t(m.costKey)}</div>
        </div>
      </div>
    </label>
  `).join('');

  const applyLabel = opts.mode === 'onboarding'
    ? t('onboarding.apply_and_start')
    : t('settings.apply');
  const cancelLabel = opts.mode === 'onboarding'
    ? t('onboarding.skip_basic')
    : t('settings.cancel');

  const titleHtml = opts.mode === 'settings'
    ? `<h2 class="text-lg font-bold mb-3">${t('settings.title')}</h2>`
    : '';

  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-content">
        ${banner}
        ${titleHtml}
        <label class="flex items-center gap-2 mb-3">
          <input type="checkbox" data-main-switch ${settings.hq_mode ? 'checked' : ''} />
          <span class="font-bold">${t('settings.hq.main_toggle_label')}</span>
          <span class="text-xs text-text-faint">${t('settings.hq.cost_time')} · ${t('settings.hq.cost_vram')}</span>
        </label>
        <details class="mb-3" open>
          <summary class="cursor-pointer text-sm text-text-muted">${t('settings.hq.advanced_toggle')}</summary>
          <div class="mt-2">${cardsHtml}</div>
        </details>
        <div class="flex gap-2 justify-end">
          <button class="pill" data-action="cancel-settings">${cancelLabel}</button>
          <button class="cta-primary" data-action="apply-settings"
            ${applyDisabled ? 'disabled' : ''}
            ${applyDisabled ? `title="${t('settings.apply_disabled_tooltip').replace('{n}', String(queueSize))}"` : ''}>
            ${applyLabel}
          </button>
        </div>
      </div>
    </div>
  `;

  bindEvents(opts, recommendation);

  // In onboarding mode, default-check all models if recommendation says hq_mode=on.
  if (opts.mode === 'onboarding' && recommendation?.hq_mode === 'on') {
    setAllModels(true);
  }
}

function bindEvents(opts: SettingsModalOptions, _recommendation: Recommendation | null): void {
  const main = document.querySelector('[data-main-switch]') as HTMLInputElement | null;
  const cards = document.querySelectorAll('[data-model-card] input[type=checkbox]') as NodeListOf<HTMLInputElement>;

  main?.addEventListener('change', () => setAllModels(main.checked));

  cards.forEach((c) =>
    c.addEventListener('change', () => {
      const allOn = Array.from(cards).every((x) => x.checked);
      if (main) main.checked = allOn;
    }),
  );

  document.querySelector('[data-action="cancel-settings"]')?.addEventListener('click', async () => {
    if (opts.mode === 'onboarding') {
      try { await dismissOnboarding(); } catch { /* non-fatal */ }
      const cur = getSettings();
      if (cur) setSettings({ ...cur, onboarding_seen: true });
    }
    closeModal();
  });

  document.querySelector('[data-action="apply-settings"]')?.addEventListener('click', async () => {
    const config = collectConfig();
    setReloadProgress({ loaded: 0, total: 0, current: null });

    streamReload(
      (ev) => {
        if ('loaded' in ev) {
          setReloadProgress({
            loaded: ev.loaded, total: ev.total, current: ev.current,
          });
        }
      },
      () => {
        clearReloadProgress();
        const cur = getSettings();
        if (cur) setSettings({ ...cur, ...config });
        if (opts.mode === 'onboarding') {
          dismissOnboarding().catch(() => {});
          const updated = getSettings();
          if (updated) setSettings({ ...updated, onboarding_seen: true });
        }
        opts.onApplied?.();
      },
    );

    try {
      await putSettings(config);
      closeModal();
    } catch {
      clearReloadProgress();
    }
  });
}

function setAllModels(checked: boolean): void {
  const main = document.querySelector('[data-main-switch]') as HTMLInputElement | null;
  if (main) main.checked = checked;
  const cards = document.querySelectorAll('[data-model-card] input[type=checkbox]') as NodeListOf<HTMLInputElement>;
  cards.forEach((c) => { c.checked = checked; });
}

interface CollectedConfig {
  hq_mode: boolean;
  hq_orientation: boolean;
  hq_unwarping: boolean;
  hq_textline: boolean;
  hq_chart: boolean;
  hq_seal: boolean;
}

function collectConfig(): CollectedConfig {
  const main = document.querySelector('[data-main-switch]') as HTMLInputElement | null;
  const out: Partial<CollectedConfig> & { hq_mode: boolean } = { hq_mode: !!main?.checked };
  document.querySelectorAll('[data-model-card] input[type=checkbox]').forEach((c) => {
    const el = c as HTMLInputElement;
    (out as Record<string, unknown>)[el.dataset.key as string] = !!el.checked;
  });
  return out as CollectedConfig;
}

function closeModal(): void {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}
