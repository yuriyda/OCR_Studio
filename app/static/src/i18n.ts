/**
 * i18n loader для UI-локализации (RU/EN).
 *
 * Редактирование:
 * - Bundles бандлятся Vite во время билда через `import './i18n/{ru,en}.json'`
 *   (resolveJsonModule=true в tsconfig). Async fetch не используется.
 * - При добавлении новой строки UI: ключ + значение должны появиться в ОБОИХ
 *   bundles одновременно (`ru.json` и `en.json`). Не добавлять только в один —
 *   `t()` отдаст ключ как fallback, что выглядит как баг.
 * - При смене языка вызывается `loadLang(lang)`, диспатчится CustomEvent
 *   'i18n:changed' на document. Подписчики (header, sidebar, tabs) перерендериваются.
 * - `applyI18nToDom(root)` — utility для одноразового замещения статичных
 *   `[data-i18n]` атрибутов на стороне HTML (используется в main.ts/boot()).
 * - Не добавлять loader для произвольных языков — это не ICU, локалей всего две.
 */

import ru from './i18n/ru.json';
import en from './i18n/en.json';
import type { LangCode } from './types';

type Bundle = Record<string, string>;
type Params = Record<string, string | number>;

const bundles: Record<LangCode, Bundle> = { ru, en };
let currentLang: LangCode = 'ru';
let bundle: Bundle = bundles.ru;

export function loadLang(lang: LangCode): void {
  bundle = bundles[lang];
  currentLang = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.dispatchEvent(new CustomEvent('i18n:changed'));
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
