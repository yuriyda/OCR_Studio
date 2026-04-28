/**
 * reload_modal.test.ts
 *
 * Unit tests for showReloadModal / hideReloadModal.
 * Covers: DOM creation, percent calculation, repeated updates, cleanup.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { showReloadModal, hideReloadModal } from '../../app/static/src/reload_modal';
import { loadLang } from '../../app/static/src/i18n';

describe('reload_modal', () => {
  beforeEach(() => {
    loadLang('en');
    document.body.innerHTML = '';
  });

  it('creates #reload-modal-root on first call', () => {
    showReloadModal({ loaded: 0, total: 10, current: null });
    expect(document.getElementById('reload-modal-root')).not.toBeNull();
  });

  it('renders 0% when loaded=0', () => {
    showReloadModal({ loaded: 0, total: 10, current: null });
    const fill = document.querySelector('.progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });

  it('renders 50% when loaded=5, total=10', () => {
    showReloadModal({ loaded: 5, total: 10, current: null });
    const fill = document.querySelector('.progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');
  });

  it('caps at 100% even when loaded > total', () => {
    showReloadModal({ loaded: 12, total: 10, current: null });
    const fill = document.querySelector('.progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('treats total=0 as 1 to avoid division by zero (shows 0%)', () => {
    showReloadModal({ loaded: 0, total: 0, current: null });
    const fill = document.querySelector('.progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });

  it('treats loaded=null as 0', () => {
    showReloadModal({ loaded: null, total: 4, current: null });
    const fill = document.querySelector('.progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });

  it('shows current model name when provided', () => {
    showReloadModal({ loaded: 2, total: 4, current: 'PP-OCRv4' });
    expect(document.body.innerHTML).toContain('PP-OCRv4');
  });

  it('does not show current model line when current=null', () => {
    showReloadModal({ loaded: 2, total: 4, current: null });
    expect(document.body.innerHTML).not.toContain('Current model:');
  });

  it('reuses existing root element on second call', () => {
    showReloadModal({ loaded: 1, total: 4, current: null });
    showReloadModal({ loaded: 2, total: 4, current: null });
    expect(document.querySelectorAll('#reload-modal-root').length).toBe(1);
  });

  it('removes the root element on hideReloadModal', () => {
    showReloadModal({ loaded: 1, total: 4, current: null });
    hideReloadModal();
    expect(document.getElementById('reload-modal-root')).toBeNull();
  });

  it('hideReloadModal is a no-op when modal was never shown', () => {
    expect(() => hideReloadModal()).not.toThrow();
  });
});
