// Простой dropdown-компонент для контекстных меню.
// Редактирование:
// - Единая точка входа: showMenu(anchor, items); items = [{label, action, disabled?, danger?}].
// - action() сама отвечает за обработку своих ошибок.
// - Outside-handler регистрируется немедленно с проверкой anchor.contains(e.target),
//   а НЕ через setTimeout(0) — это устойчивее в jsdom и не имеет race condition в браузере.

let currentMenu = null;
let outsideHandler = null;
let escHandler = null;

export function hideMenu() {
  if (currentMenu) {
    currentMenu.remove();
    currentMenu = null;
  }
  if (outsideHandler) {
    document.removeEventListener('mousedown', outsideHandler);
    outsideHandler = null;
  }
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
}

export function showMenu(anchor, items) {
  hideMenu();
  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 2}px`;
  menu.style.left = `${rect.left}px`;
  menu.style.zIndex = '1000';

  for (const it of items) {
    const el = document.createElement('div');
    let classes = 'menu-item';
    if (it.disabled) classes += ' disabled';
    if (it.danger) classes += ' danger';
    el.className = classes;
    el.setAttribute('role', 'menuitem');
    el.textContent = it.label;
    if (!it.disabled) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        hideMenu();
        it.action();
      });
    }
    menu.appendChild(el);
  }

  document.body.appendChild(menu);
  currentMenu = menu;

  outsideHandler = (e) => {
    if (!menu.contains(e.target) && !anchor.contains(e.target)) hideMenu();
  };
  document.addEventListener('mousedown', outsideHandler);

  escHandler = (e) => {
    if (e.key === 'Escape') hideMenu();
  };
  document.addEventListener('keydown', escHandler);
}
