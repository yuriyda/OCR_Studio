/**
 * Toast notifications with icons, keyboard support (Esc), and aria markup.
 *
 * Maintenance notes:
 * - MAX_TOASTS=5 — do not show more, old ones are removed FIFO. Do not remove
 *   the limit: otherwise the screen can be flooded during a long polling failure.
 * - Icons (✓⚠ℹ) are required for color-blind users. Do not leave only a colored border.
 * - role=alert for errors (assistive tech interrupts) / role=status for info+success
 *   (assistive tech waits politely). Do not change.
 * - Esc-handler is global, installed lazily (on first show).
 * - Styling — via classes `.toast-base / .toast-success / -error / -info`
 *   from `main.css`. Do not pass styles inline.
 */

type ToastType = 'success' | 'error' | 'info';
type Position = 'top-right' | 'bottom-right';

interface ToastOptions {
  position?: Position;
  duration?: number;
}

const ICONS: Record<ToastType, string> = { success: '✓', error: '⚠', info: 'ℹ' };
const MAX_TOASTS = 5;

let escListenerInstalled = false;

function installEscListener(): void {
  if (escListenerInstalled) return;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const focused = document.activeElement;
    if (focused && focused.classList.contains('toast-base')) {
      focused.remove();
    }
  });
  escListenerInstalled = true;
}

export const toast = {
  show(message: string, type: ToastType = 'info', opts: ToastOptions = {}): void {
    installEscListener();
    const container = document.getElementById('toast-container');
    if (!container) return;

    while (container.children.length >= MAX_TOASTS) {
      container.firstElementChild?.remove();
    }

    const el = document.createElement('div');
    el.className = `toast-base toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', 'polite');
    el.tabIndex = 0;
    el.textContent = `${ICONS[type]}  ${message}`;
    el.addEventListener('click', () => el.remove());

    if (opts.position === 'top-right') {
      // Single container; reposition it as needed (last show wins).
      container.style.top = '20px';
      container.style.bottom = '';
    }

    container.appendChild(el);

    const duration = opts.duration ?? 4000;
    setTimeout(() => el.remove(), duration);
  },
};
