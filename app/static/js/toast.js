// Неблокирующий toast-компонент.
// Редактирование: типы (info/success/error) — единый источник правды; не дублировать в других модулях.

const DEFAULT_TIMEOUT_MS = 3000;
const CONTAINER_ID = 'toast-container';

function ensureContainer() {
  let c = document.getElementById(CONTAINER_ID);
  if (!c) {
    c = document.createElement('div');
    c.id = CONTAINER_ID;
    document.body.appendChild(c);
  }
  return c;
}

export const toast = {
  show(message, type = 'info', timeoutMs = DEFAULT_TIMEOUT_MS) {
    const container = ensureContainer();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;

    const dismiss = () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };

    el.addEventListener('click', dismiss);
    container.appendChild(el);

    if (timeoutMs > 0) {
      setTimeout(dismiss, timeoutMs);
    }

    return dismiss;
  },
};
