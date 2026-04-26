import { describe, it, expect, beforeEach } from 'vitest';
import { toast } from '../../app/static/src/toast';

describe('toast', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="toast-container"></div>';
  });

  it('renders with success icon ✓', () => {
    toast.show('Saved', 'success');
    const el = document.querySelector('.toast-success');
    expect(el).toBeTruthy();
    expect(el?.textContent).toContain('✓');
    expect(el?.textContent).toContain('Saved');
  });

  it('renders with error icon ⚠ and role=alert', () => {
    toast.show('Bad', 'error');
    const el = document.querySelector('.toast-error');
    expect(el?.textContent).toContain('⚠');
    expect(el?.getAttribute('role')).toBe('alert');
  });

  it('renders info with ℹ icon and role=status', () => {
    toast.show('Info', 'info');
    const el = document.querySelector('.toast-info');
    expect(el?.textContent).toContain('ℹ');
    expect(el?.getAttribute('role')).toBe('status');
  });

  it('caps at MAX_TOASTS=5', () => {
    for (let i = 0; i < 8; i++) toast.show(`m${i}`, 'info');
    expect(document.querySelectorAll('.toast-base').length).toBeLessThanOrEqual(5);
  });

  it('Esc closes focused toast', () => {
    toast.show('Press esc', 'info');
    const el = document.querySelector('.toast-base') as HTMLElement;
    el.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.toast-base')).toBeNull();
  });

  it('clicking removes toast', () => {
    toast.show('click me', 'info');
    const el = document.querySelector('.toast-base') as HTMLElement;
    el.click();
    expect(document.querySelector('.toast-base')).toBeNull();
  });

  it('aria-live=polite on all toasts', () => {
    toast.show('m', 'info');
    const el = document.querySelector('.toast-base');
    expect(el?.getAttribute('aria-live')).toBe('polite');
  });

  it('tabindex=0 for keyboard focus', () => {
    toast.show('m', 'info');
    const el = document.querySelector('.toast-base') as HTMLElement;
    expect(el.tabIndex).toBe(0);
  });
});
