/**
 * reload_modal.ts
 *
 * Full-screen overlay shown while the engine re-initialises after Apply.
 *
 * Maintenance notes:
 * - Re-renders on every state.reloadProgress change (caller drives this).
 * - No Cancel button by design — interrupting PPStructureV3(...) construction
 *   may corrupt engine state.
 * - i18n keys: reload.title, reload.loaded_n_of_m, reload.current_model, reload.hint.
 * - DOM: a single #reload-modal-root div is created lazily on first call and
 *   removed entirely by hideReloadModal(). No persistent DOM footprint.
 * - DOM identity is preserved across updates (no innerHTML replacement after first build)
 *   to prevent flicker caused by full repaint on each progress event.
 */
import { t } from './i18n';
import type { ReloadProgress } from './state';

const ROOT_ID = 'reload-modal-root';

/**
 * Render (or update) the reload overlay with current progress.
 * On first call, builds the full DOM structure once.
 * On subsequent calls, updates only text content and progress bar width in-place
 * without touching innerHTML — prevents browser repaint flicker.
 */
export function showReloadModal(progress: ReloadProgress): void {
  const total = progress.total || 1;
  const loaded = progress.loaded ?? 0;
  const pct = Math.min(100, Math.round((loaded / total) * 100));
  const counterText = t('reload.loaded_n_of_m').replace('{loaded}', String(loaded)).replace('{total}', String(total));
  const currentText = progress.current ? t('reload.current_model').replace('{name}', progress.current) : '';

  let root = document.getElementById(ROOT_ID);

  if (!root) {
    // First call: build the complete DOM structure once.
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.appendChild(root);
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-content">
          <h2 class="text-lg font-bold mb-3">${t('reload.title')}</h2>
          <div class="mb-2 text-sm" data-reload-counter></div>
          <div class="w-full h-3 bg-surface rounded overflow-hidden mb-3">
            <div class="progress-fill" data-reload-fill style="width: 0%;"></div>
          </div>
          <div class="text-sm text-text-muted mb-2" data-reload-current></div>
          <div class="text-xs text-text-faint">${t('reload.hint')}</div>
        </div>
      </div>
    `;
  }

  // Subsequent calls (and also first call after innerHTML set above):
  // update only the dynamic parts — no DOM rebuild, no repaint of the whole modal.
  const counterEl = root.querySelector<HTMLElement>('[data-reload-counter]');
  const fillEl = root.querySelector<HTMLElement>('[data-reload-fill]');
  const currentEl = root.querySelector<HTMLElement>('[data-reload-current]');
  if (counterEl) counterEl.textContent = counterText;
  if (fillEl) fillEl.style.width = `${pct}%`;
  if (currentEl) currentEl.textContent = currentText;
}

/**
 * Remove the reload overlay from the DOM entirely.
 * No-op if it was never shown.
 */
export function hideReloadModal(): void {
  const root = document.getElementById(ROOT_ID);
  if (root) root.remove();
}
