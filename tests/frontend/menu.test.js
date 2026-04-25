import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showMenu, hideMenu } from '../../app/static/js/menu.js';

describe('menu', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('showMenu renders items relative to anchor', () => {
    document.body.innerHTML = '<button id="anchor">⋮</button>';
    const anchor = document.getElementById('anchor');
    showMenu(anchor, [
      { label: 'Rename', action: () => {} },
      { label: 'Delete', action: () => {} },
    ]);
    const menu = document.querySelector('.context-menu');
    expect(menu).toBeTruthy();
    expect(menu.querySelectorAll('.menu-item').length).toBe(2);
    expect(menu.textContent).toContain('Rename');
    expect(menu.textContent).toContain('Delete');
  });

  it('clicking item invokes action and closes menu', () => {
    document.body.innerHTML = '<button id="anchor">⋮</button>';
    const anchor = document.getElementById('anchor');
    const action = vi.fn();
    showMenu(anchor, [{ label: 'Do', action }]);
    const item = document.querySelector('.menu-item');
    item.click();
    expect(action).toHaveBeenCalled();
    expect(document.querySelector('.context-menu')).toBeFalsy();
  });

  it('hideMenu removes menu', () => {
    document.body.innerHTML = '<button id="anchor">⋮</button>';
    const anchor = document.getElementById('anchor');
    showMenu(anchor, [{ label: 'X', action: () => {} }]);
    hideMenu();
    expect(document.querySelector('.context-menu')).toBeFalsy();
  });

  it('clicking outside the menu closes it', () => {
    document.body.innerHTML = '<button id="anchor">⋮</button><div id="elsewhere"></div>';
    const anchor = document.getElementById('anchor');
    showMenu(anchor, [{ label: 'X', action: () => {} }]);
    document.getElementById('elsewhere').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.context-menu')).toBeFalsy();
  });
});
