/**
 * Context menu (dropdown) with keyboard / click-outside dismiss.
 *
 * Maintenance notes:
 * - Only one active menu at a time — `showMenu` closes the previous one first.
 * - role=menu / menuitem are required for accessibility.
 * - Listeners (Esc + click outside) are installed on open and removed on close
 *   to prevent memory leaks.
 * - Click-outside is registered with a setTimeout(0) delay; otherwise the same click
 *   that opened the menu would immediately close it.
 * - Styles — `.context-menu / .menu-item / .menu-item.danger` from main.css.
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
  menu.className = 'context-menu bg-bg border border-border rounded-md shadow-glass absolute z-50';
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
