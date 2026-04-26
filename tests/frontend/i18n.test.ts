import { describe, it, expect, beforeEach } from 'vitest';
import { loadLang, t, getCurrentLang, applyI18nToDom } from '../../app/static/src/i18n';
import ruBundle from '../../app/static/src/i18n/ru.json';
import enBundle from '../../app/static/src/i18n/en.json';
import type { LangCode } from '../../app/static/src/types';

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

  it('dispatches i18n:changed event with detail.lang', () => {
    let receivedLang: LangCode | null = null;
    document.addEventListener('i18n:changed', (e) => {
      receivedLang = (e as CustomEvent<{ lang: LangCode }>).detail.lang;
    }, { once: true });
    loadLang('en');
    expect(receivedLang).toBe('en');
  });

  it('sets document.documentElement.lang on switch', () => {
    loadLang('en');
    expect(document.documentElement.lang).toBe('en');
    loadLang('ru');
    expect(document.documentElement.lang).toBe('ru');
  });

  it('auto re-binds [data-i18n] markup on loadLang', () => {
    document.body.innerHTML = '<span data-i18n="header.recognize" id="t">x</span>';
    loadLang('ru');
    expect(document.getElementById('t')?.textContent).toBe('Распознать');
    loadLang('en');
    expect(document.getElementById('t')?.textContent).toBe('Recognize');
    document.body.innerHTML = '';
  });

  it('applyI18nToDom replaces data-i18n textContent and data-i18n-placeholder', () => {
    document.body.innerHTML = `
      <span data-i18n="btn.copy" id="a">x</span>
      <input data-i18n-placeholder="modal.project.create" id="b" />
    `;
    applyI18nToDom();
    expect(document.getElementById('a')?.textContent).toBe('Копировать');
    expect((document.getElementById('b') as HTMLInputElement).placeholder).toBe('Имя нового проекта');
    document.body.innerHTML = '';
  });
});

describe('i18n bundle parity', () => {
  it('ru and en have identical key sets (drift guard)', () => {
    const ruKeys = Object.keys(ruBundle).sort();
    const enKeys = Object.keys(enBundle).sort();
    expect(enKeys).toEqual(ruKeys);
  });

  it('all bundle values are non-empty strings', () => {
    for (const v of Object.values(ruBundle)) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
    for (const v of Object.values(enBundle)) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });
});
