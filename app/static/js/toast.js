// Неблокирующий toast-компонент.
// Редактирование:
// - Типы 'info' | 'success' | 'error' — допустимые значения; CSS-классы определены в index.html.
// - timeoutMs <= 0 отключает автодисмисс (sticky toast).
// - При флуде сообщений старые удаляются автоматически (MAX_TOASTS).

const DEFAULT_TIMEOUT_MS = 3000;
const CONTAINER_ID = 'toast-container';
const MAX_TOASTS = 5;

function ensureContainer() {
  let c = document.getElementById(CONTAINER_ID);
  if (!c) {
    c = document.createElement('div');
    c.id = CONTAINER_ID;
    c.setAttribute('aria-live', 'polite');
    c.setAttribute('aria-atomic', 'false');
    document.body.appendChild(c);
  } else if (!c.hasAttribute('aria-live')) {
    c.setAttribute('aria-live', 'polite');
    c.setAttribute('aria-atomic', 'false');
  }
  return c;
}

function trimOldest(container) {
  while (container.children.length > MAX_TOASTS) {
    container.removeChild(container.firstChild);
  }
}

export const toast = {
  show(message, type = 'info', timeoutMs = DEFAULT_TIMEOUT_MS) {
    const container = ensureContainer();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;

    const dismiss = () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };

    el.addEventListener('click', dismiss);
    container.appendChild(el);
    trimOldest(container);

    if (timeoutMs > 0) {
      setTimeout(dismiss, timeoutMs);
    }

    return dismiss;
  },
};
