/**
 * Custom modal dialogs replacing native prompt/confirm, styled with Glass+Neon.
 *
 * Maintenance notes:
 * - DOM is created dynamically and removed on finish — there is no persistent overlay.
 * - Esc / click-outside / Cancel → resolve null/false. Enter / Save / OK → resolve value/true.
 * - i18n strings come via `t('modal.btn.save'|'cancel'|'ok')` — change only in i18n bundles.
 * - Do not use `window.prompt` / `window.confirm` — they block the main thread
 *   and are ignored by modern UI standards.
 * - Styles — via classes `.modal-overlay/.modal-content/.modal-input/.modal-cancel/.modal-save`
 *   from main.css. Inline styles only for unique one-off cases.
 */

import { t } from './i18n';

interface PromptOptions {
  placeholder?: string;
}

function buildOverlay(): { overlay: HTMLDivElement; close: () => void } {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  document.body.appendChild(overlay);
  const close = (): void => overlay.remove();
  return { overlay, close };
}

function escClose(closeAndResolve: () => void): (e: KeyboardEvent) => void {
  const handler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', handler);
      closeAndResolve();
    }
  };
  document.addEventListener('keydown', handler);
  return handler;
}

export const modal = {
  prompt(title: string, defaultValue: string = '', _opts: PromptOptions = {}): Promise<string | null> {
    return new Promise((resolve) => {
      const { overlay, close } = buildOverlay();
      overlay.innerHTML = `
        <div class="modal-content">
          <h3 class="modal-title text-lg font-semibold mb-3"></h3>
          <input class="modal-input bg-bg-mid border border-border text-text rounded px-3 py-2 w-full mb-4" type="text" />
          <div class="modal-actions flex justify-end gap-2">
            <button class="modal-cancel pill"></button>
            <button class="modal-save cta-primary"></button>
          </div>
        </div>`;
      const titleEl = overlay.querySelector<HTMLElement>('.modal-title')!;
      titleEl.textContent = title;
      const input = overlay.querySelector<HTMLInputElement>('.modal-input')!;
      input.value = defaultValue;
      input.focus();
      input.select();
      const cancelBtn = overlay.querySelector<HTMLButtonElement>('.modal-cancel')!;
      const saveBtn = overlay.querySelector<HTMLButtonElement>('.modal-save')!;
      cancelBtn.textContent = t('modal.btn.cancel');
      saveBtn.textContent = t('modal.btn.save');

      let escHandler: ((e: KeyboardEvent) => void) | null = null;
      const finish = (v: string | null): void => {
        if (escHandler) document.removeEventListener('keydown', escHandler);
        close();
        resolve(v);
      };
      escHandler = escClose(() => finish(null));
      cancelBtn.addEventListener('click', () => finish(null));
      saveBtn.addEventListener('click', () => finish(input.value));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(input.value); });

      // Click on overlay outside content
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) finish(null);
      });
    });
  },

  confirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const { overlay, close } = buildOverlay();
      overlay.innerHTML = `
        <div class="modal-content">
          <h3 class="modal-title text-lg font-semibold mb-2"></h3>
          <p class="modal-message text-text-muted mb-4"></p>
          <div class="modal-actions flex justify-end gap-2">
            <button class="modal-cancel pill"></button>
            <button class="modal-save cta-primary"></button>
          </div>
        </div>`;
      overlay.querySelector<HTMLElement>('.modal-title')!.textContent = title;
      overlay.querySelector<HTMLElement>('.modal-message')!.textContent = message;
      const cancelBtn = overlay.querySelector<HTMLButtonElement>('.modal-cancel')!;
      const saveBtn = overlay.querySelector<HTMLButtonElement>('.modal-save')!;
      cancelBtn.textContent = t('modal.btn.cancel');
      saveBtn.textContent = t('modal.btn.ok');

      let escHandler: ((e: KeyboardEvent) => void) | null = null;
      const finish = (v: boolean): void => {
        if (escHandler) document.removeEventListener('keydown', escHandler);
        close();
        resolve(v);
      };
      escHandler = escClose(() => finish(false));
      cancelBtn.addEventListener('click', () => finish(false));
      saveBtn.addEventListener('click', () => finish(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) finish(false);
      });
    });
  },
};
