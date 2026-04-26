import { describe, it, expect, beforeEach } from 'vitest';
import { showMenu, hideMenu } from '../../app/static/src/menu';

describe('menu', () => {
  beforeEach(() => { document.body.innerHTML = '<button id="anchor">x</button>'; });

  it('renders menu items with correct roles', () => {
    const anchor = document.getElementById('anchor')!;
    showMenu(anchor, [
      { label: 'Edit', action: () => {} },
      { label: 'Delete', danger: true, action: () => {} },
    ]);
    expect(document.querySelectorAll('.menu-item').length).toBe(2);
    expect(document.querySelector('.menu-item.danger')).toBeTruthy();
    expect(document.querySelector('.context-menu')?.getAttribute('role')).toBe('menu');
    expect(document.querySelector('.menu-item')?.getAttribute('role')).toBe('menuitem');
  });

  it('Esc hides menu', () => {
    showMenu(document.getElementById('anchor')!, [{ label: 'X', action: () => {} }]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('clicking item invokes action and hides menu', () => {
    let called = false;
    showMenu(document.getElementById('anchor')!, [
      { label: 'Click me', action: () => { called = true; } },
    ]);
    (document.querySelector('.menu-item') as HTMLElement).click();
    expect(called).toBe(true);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('hideMenu removes menu', () => {
    showMenu(document.getElementById('anchor')!, [{ label: 'X', action: () => {} }]);
    hideMenu();
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('opening new menu closes previous', () => {
    const a = document.getElementById('anchor')!;
    showMenu(a, [{ label: 'A', action: () => {} }]);
    showMenu(a, [{ label: 'B', action: () => {} }]);
    expect(document.querySelectorAll('.context-menu').length).toBe(1);
  });
});
