// Простой dropdown-компонент для контекстных меню.
// Редактирование: единая точка входа showMenu(anchor, items); items = [{label, action, disabled?}].

let currentMenu = null;
let outsideHandler = null;

export function hideMenu() {
  if (currentMenu) {
    currentMenu.remove();
    currentMenu = null;
  }
  if (outsideHandler) {
    document.removeEventListener('mousedown', outsideHandler);
    outsideHandler = null;
  }
}

export function showMenu(anchor, items) {
  hideMenu();
  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 2}px`;
  menu.style.left = `${rect.left}px`;
  menu.style.zIndex = '1000';

  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'menu-item' + (it.disabled ? ' disabled' : '');
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
}
