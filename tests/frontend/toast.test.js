import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { toast } from '../../app/static/js/toast.js';

describe('toast', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="toast-container"></div>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('show creates a toast element', () => {
    toast.show('Hello');
    const t = document.querySelector('#toast-container .toast');
    expect(t).toBeTruthy();
    expect(t.textContent).toContain('Hello');
  });

  it('show with type adds class', () => {
    toast.show('Bad', 'error');
    const t = document.querySelector('.toast.error');
    expect(t).toBeTruthy();
  });

  it('show with success type', () => {
    toast.show('OK', 'success');
    const t = document.querySelector('.toast.success');
    expect(t).toBeTruthy();
  });

  it('multiple toasts stack', () => {
    toast.show('A');
    toast.show('B');
    toast.show('C');
    expect(document.querySelectorAll('.toast').length).toBe(3);
  });

  it('toast auto-dismisses after timeout', () => {
    toast.show('X', 'info', 1000);
    expect(document.querySelectorAll('.toast').length).toBe(1);
    vi.advanceTimersByTime(1100);
    expect(document.querySelectorAll('.toast').length).toBe(0);
  });

  it('clicking a toast removes it', () => {
    toast.show('Y');
    const t = document.querySelector('.toast');
    t.click();
    expect(document.querySelectorAll('.toast').length).toBe(0);
  });

  it('show returns a dismiss function', () => {
    const dismiss = toast.show('Z');
    expect(document.querySelectorAll('.toast').length).toBe(1);
    dismiss();
    expect(document.querySelectorAll('.toast').length).toBe(0);
  });
});
