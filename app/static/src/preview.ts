/**
 * Result pane: рендер OCR-результата с адаптивными табами по формату вывода.
 *
 * Редактирование:
 * - Табы зависят от format документа (md → Markdown+Preview, txt → Text, docx → Document).
 * - Markdown/Text режим — `<pre>` с raw текстом (escaped).
 * - Preview/Document режим — HTML из бэкенда (sanitized bleach в app/preview.py).
 *   ВНИМАНИЕ: HTML вставляется через innerHTML, доверяем backend sanitization.
 * - При ошибке API показываем preview.unavailable, не падаем.
 * - Не fetch'им сами — controller (main.ts) передаёт api клиент.
 */

import type { Document, OcrFormat } from './types';
import { t } from './i18n';

export type ResultTabKey = 'markdown' | 'preview' | 'text' | 'document';

export interface ResultTab {
  key: ResultTabKey;
  label: string;
}

export function tabsForFormat(format: OcrFormat): ResultTab[] {
  switch (format) {
    case 'md':
      return [
        { key: 'markdown', label: t('tab.markdown') },
        { key: 'preview', label: t('tab.preview') },
      ];
    case 'txt':
      return [{ key: 'text', label: t('tab.text') }];
    case 'docx':
      return [{ key: 'document', label: t('tab.document') }];
  }
}

interface ResultApi {
  getMarkdown(id: string): Promise<string>;
  getRendered(id: string): Promise<string>;
}

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
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
  try {
    if (tab === 'markdown' || tab === 'text') {
      const text = await api.getMarkdown(doc.id);
      container.innerHTML = `<pre class="whitespace-pre-wrap break-words text-sm font-mono leading-relaxed">${escHtml(text)}</pre>`;
    } else {
      const html = await api.getRendered(doc.id);
      container.innerHTML = `<div class="rendered prose prose-invert max-w-none">${html}</div>`;
    }
  } catch {
    container.innerHTML = `<div class="text-error text-center py-10">${t('preview.unavailable')}</div>`;
  }
}
