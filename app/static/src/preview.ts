/**
 * Result pane: рендер результата OCR с фиксированными 3 табами.
 *
 * Редактирование:
 * - Табы всегда: Markdown / Превью / TXT. Не зависят от doc.format.
 *   DOCX доступен через download-кнопку, не таб.
 * - Markdown / Превью читают result.md (canonical).
 * - TXT лениво генерится backend'ом из result.md при первом запросе.
 * - Если у legacy-документа нет result.md → backend возвращает 404 → показываем
 *   preview.source_unavailable.
 * - Markdown / TXT режимы → <pre> с raw text (escaped).
 * - Превью режим → HTML из бэкенда (sanitized bleach).
 */

import type { Document } from './types';
import { t } from './i18n';

export type ResultTabKey = 'markdown' | 'preview' | 'text';

export interface ResultTab {
  key: ResultTabKey;
  label: string;
}

/**
 * Возвращает фиксированные 3 таба (с актуальными i18n-метками).
 * Не используем константу — labels зависят от текущего языка, который меняется в runtime.
 */
export function allResultTabs(): ResultTab[] {
  return [
    { key: 'markdown', label: t('tab.markdown') },
    { key: 'preview', label: t('tab.preview') },
    { key: 'text', label: t('tab.text') },
  ];
}

/**
 * Маппинг таба → формат (для api.resultUrl и для определения availability).
 */
export const TAB_TO_FORMAT: Record<ResultTabKey, 'md' | 'txt'> = {
  markdown: 'md',
  preview: 'md',
  text: 'txt',
};

/**
 * Доступен ли таб для документа? (на основе available_formats + источника md).
 * Markdown/Превью требуют 'md' в available_formats.
 * TXT доступен если 'md' (источник для генерации) ИЛИ 'txt' (если уже есть на диске).
 */
export function isTabAvailable(tab: ResultTabKey, available: string[]): boolean {
  if (tab === 'markdown' || tab === 'preview') return available.includes('md');
  if (tab === 'text') return available.includes('md') || available.includes('txt');
  return false;
}

interface ResultApi {
  getMarkdown(id: string, format?: 'md' | 'txt'): Promise<string>;
  getRendered(id: string, format?: 'md' | 'docx'): Promise<string>;
}

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function spinner(): string {
  return '<div class="text-text-muted text-center py-10"><div class="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin"></div></div>';
}

export async function renderResult(
  container: HTMLElement,
  doc: Document | null,
  tab: ResultTabKey,
  api: ResultApi,
): Promise<void> {
  if (!doc) {
    container.innerHTML = `<div class="text-text-muted text-center py-10">${t('preview.empty')}</div>`;
    return;
  }
  if (doc.status !== 'done') {
    container.innerHTML = `<div class="text-text-muted text-center py-10">${t('preview.unavailable')}</div>`;
    return;
  }
  if (!isTabAvailable(tab, doc.available_formats)) {
    container.innerHTML = `<div class="text-text-muted text-center py-10">${t('preview.source_unavailable')}</div>`;
    return;
  }

  // Show spinner while loading
  container.innerHTML = spinner();
  try {
    if (tab === 'markdown') {
      const text = await api.getMarkdown(doc.id, 'md');
      container.innerHTML = `<pre class="whitespace-pre-wrap break-words text-sm font-mono leading-relaxed">${escHtml(text)}</pre>`;
    } else if (tab === 'text') {
      const text = await api.getMarkdown(doc.id, 'txt');
      container.innerHTML = `<pre class="whitespace-pre-wrap break-words text-sm font-mono leading-relaxed">${escHtml(text)}</pre>`;
    } else if (tab === 'preview') {
      const html = await api.getRendered(doc.id, 'md');
      container.innerHTML = `<div class="rendered prose prose-invert max-w-none">${html}</div>`;
    }
  } catch {
    container.innerHTML = `<div class="text-error text-center py-10">${t('preview.unavailable')}</div>`;
  }
}
