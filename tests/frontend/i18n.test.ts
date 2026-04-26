import { describe, it, expect, beforeEach } from 'vitest';
import { loadLang, t, getCurrentLang } from '../../app/static/src/i18n';

describe('i18n', () => {
  beforeEach(() => loadLang('ru'));

  it('loads ru by default after loadLang(ru)', () => {
    expect(getCurrentLang()).toBe('ru');
    expect(t('header.title')).toBe('OCR Studio');
  });

  it('switches to en', () => {
    loadLang('en');
    expect(getCurrentLang()).toBe('en');
    expect(t('header.recognize')).toBe('Recognize');
  });

  it('returns key when missing', () => {
    expect(t('totally.unknown.key')).toBe('totally.unknown.key');
  });

  it('interpolates params', () => {
    expect(t('doc.page.counter', { current: 7, total: 12 })).toBe('стр 7/12');
    loadLang('en');
    expect(t('doc.page.counter', { current: 7, total: 12 })).toBe('page 7/12');
  });

  it('dispatches i18n:changed event', () => {
    let called = false;
    document.addEventListener('i18n:changed', () => { called = true; }, { once: true });
    loadLang('en');
    expect(called).toBe(true);
  });
});
