/**
 * i18n loader for UI localisation (RU/EN).
 *
 * Maintenance notes:
 * - Bundles are bundled by Vite at build time via `import './i18n/{ru,en}.json'`
 *   (resolveJsonModule=true in tsconfig). Async fetch is not used.
 * - When adding a new UI string: key + value must appear in BOTH bundles at the same time
 *   (`ru.json` and `en.json`). Adding to only one — `t()` returns the key as fallback,
 *   which looks like a bug.
 * - Language change calls `loadLang(lang)`. This automatically:
 *   (1) runs `applyI18nToDom(document)` to update static `[data-i18n]` / `[data-i18n-placeholder]`
 *   attributes, (2) dispatches a typed CustomEvent 'i18n:changed' with `detail.lang` —
 *   dynamic components (statusbar, project list) subscribe and re-render themselves.
 * - `applyI18nToDom(root)` — utility, can be called manually for a specific subtree
 *   (e.g. after rendering dynamic HTML with `data-i18n` markers).
 * - Place `data-i18n` ONLY on leaf elements (containing text only). Otherwise
 *   `textContent` overwrites child nodes (e.g. an <svg> icon).
 * - Do not add loaders for arbitrary languages — this is not ICU, there are only two locales.
 */

import ru from './i18n/ru.json';
import en from './i18n/en.json';
import type { LangCode } from './types';

type Bundle = Record<string, string>;
type Params = Record<string, string | number>;

const bundles: Record<LangCode, Bundle> = { ru, en };
let currentLang: LangCode = 'ru';
let bundle: Bundle = bundles.ru;

export interface I18nChangedEvent extends CustomEvent<{ lang: LangCode }> {}

export function loadLang(lang: LangCode): void {
  bundle = bundles[lang];
  currentLang = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    applyI18nToDom(document);
    document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
  }
}

export function t(key: string, params: Params = {}): string {
  let str = bundle[key] ?? key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return str;
}

export function getCurrentLang(): LangCode {
  return currentLang;
}

export function applyI18nToDom(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (key && 'placeholder' in el) (el as HTMLInputElement).placeholder = t(key);
  });
}
