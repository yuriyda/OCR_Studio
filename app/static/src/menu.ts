/**
 * Context menu (dropdown) с keyboard / click-outside dismiss.
 *
 * Редактирование:
 * - Только один активный menu — `showMenu` сначала закрывает предыдущий.
 * - role=menu / menuitem обязательны для accessibility.
 * - Listeners (Esc + click outside) инсталлируются на open и снимаются на close,
 *   чтобы не утекала память.
 * - Click outside ставится с задержкой setTimeout(0), иначе тот же click,
 *   который открыл menu, тут же закроет его.
 * - Стили — `.context-menu / .menu-item / .menu-item.danger` из main.css.
 */

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

let activeMenu: HTMLElement | null = null;
let escListener: ((e: KeyboardEvent) => void) | null = null;
let outsideListener: ((e: MouseEvent) => void) | null = null;

export function hideMenu(): void {
  if (activeMenu) { activeMenu.remove(); activeMenu = null; }
  if (escListener) { document.removeEventListener('keydown', escListener); escListener = null; }
  if (outsideListener) { document.removeEventListener('click', outsideListener, true); outsideListener = null; }
}

export function showMenu(anchor: HTMLElement, items: MenuItem[]): void {
  hideMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu glass-panel rounded-md shadow-glass absolute z-50';
  menu.setAttribute('role', 'menu');

  for (const item of items) {
    const el = document.createElement('div');
    el.className = `menu-item px-3 py-2 cursor-pointer hover:bg-surface-hover ${item.danger ? 'danger text-error' : ''}`;
    el.setAttribute('role', 'menuitem');
    el.tabIndex = 0;
    el.textContent = item.label;
    el.addEventListener('click', () => { hideMenu(); item.action(); });
    menu.appendChild(el);
  }

  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  activeMenu = menu;
  escListener = (e: KeyboardEvent): void => { if (e.key === 'Escape') hideMenu(); };
  outsideListener = (e: MouseEvent): void => {
    if (activeMenu && !activeMenu.contains(e.target as Node)) hideMenu();
  };
  document.addEventListener('keydown', escListener);
  setTimeout(() => { if (outsideListener) document.addEventListener('click', outsideListener, true); }, 0);
}
