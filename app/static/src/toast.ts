/**
 * Toast-уведомления с иконками, поддержкой клавиатуры (Esc), aria-разметкой.
 *
 * Редактирование:
 * - MAX_TOASTS=5 — больше не показывать, старые удаляются по FIFO. Не убирать
 *   ограничение: иначе можно завалить экран при долгом polling-фейлe.
 * - Иконки (✓⚠ℹ) обязательны для color-blind. Не оставлять только цветную рамку.
 * - role=alert для errors (assistive tech прерывает) / role=status для info+success
 *   (assistive tech вежливо ждёт). Не менять.
 * - Esc-handler глобальный, инсталлируется лениво (на первом show).
 * - Стилистика — через классы `.toast-base / .toast-success / -error / -info`
 *   из `main.css`. Не прокидывать стили inline.
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
      // Контейнер один; перемещаем его при необходимости (последний show выигрывает).
      container.style.top = '20px';
      container.style.bottom = '';
    }

    container.appendChild(el);

    const duration = opts.duration ?? 4000;
    setTimeout(() => el.remove(), duration);
  },
};
