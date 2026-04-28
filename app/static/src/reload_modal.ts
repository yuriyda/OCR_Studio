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
 */
import { t } from './i18n';
import type { ReloadProgress } from './state';

const ROOT_ID = 'reload-modal-root';

/**
 * Render (or update) the reload overlay with current progress.
 * Safe to call repeatedly — updates innerHTML in-place.
 */
export function showReloadModal(progress: ReloadProgress): void {
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.appendChild(root);
  }

  const total = progress.total || 1;
  const loaded = progress.loaded ?? 0;
  const pct = Math.min(100, Math.round((loaded / total) * 100));

  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-content">
        <h2 class="text-lg font-bold mb-3">${t('reload.title')}</h2>
        <div class="mb-2 text-sm">
          ${t('reload.loaded_n_of_m').replace('{loaded}', String(loaded)).replace('{total}', String(total))}
        </div>
        <div class="w-full h-3 bg-surface rounded overflow-hidden mb-3">
          <div class="progress-fill" style="width: ${pct}%;"></div>
        </div>
        <div class="text-sm text-text-muted mb-2">
          ${progress.current ? t('reload.current_model').replace('{name}', progress.current) : ''}
        </div>
        <div class="text-xs text-text-faint">${t('reload.hint')}</div>
      </div>
    </div>
  `;
}

/**
 * Remove the reload overlay from the DOM entirely.
 * No-op if it was never shown.
 */
export function hideReloadModal(): void {
  const root = document.getElementById(ROOT_ID);
  if (root) root.remove();
}
