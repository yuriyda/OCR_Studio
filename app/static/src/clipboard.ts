/**
 * Подготовка текста для копирования в буфер обмена.
 *
 * Редактирование:
 * - `htmlToPlainText` обрабатывает DOM из rendered HTML (для docx). Блочные
 *   элементы добавляют `\n`, ячейки таблицы (`TD`/`TH`) разделяются `\t`.
 *   Меняешь набор тегов — обнови `BLOCK_TAGS`.
 * - `getCopyText` для md/txt возвращает RAW markdown (через `apiClient.getMarkdown`
 *   → `string`). Для docx — plain-text из rendered HTML (`apiClient.getRendered`
 *   → `string`). API в `api.ts` возвращает строку напрямую, не объект.
 * - Никакого DOM-стейта или toast-логики здесь — это чистый утилитарный модуль.
 *   UI-сторона (toast/clipboard write) — в main.ts/app слое.
 */

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'BR', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE',
]);

export function htmlToPlainText(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const out: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    for (const child of Array.from(el.childNodes)) walk(child);
    if (tag === 'TD' || tag === 'TH') {
      out.push('\t');
    } else if (BLOCK_TAGS.has(tag)) {
      out.push('\n');
    }
  };
  for (const c of Array.from(tmp.childNodes)) walk(c);
  return out.join('').replace(/\t\n/g, '\n').replace(/\n\n+/g, '\n\n').trim();
}

export interface DocLite {
  id: string;
  format: string;
}

export interface ClipboardApiClient {
  getMarkdown(id: string): Promise<string>;
  getRendered(id: string): Promise<string>;
}

export async function getCopyText(
  doc: DocLite | undefined,
  apiClient: ClipboardApiClient,
): Promise<string> {
  if (!doc) return '';
  if (doc.format === 'docx') {
    const html = await apiClient.getRendered(doc.id);
    return htmlToPlainText(html);
  }
  return apiClient.getMarkdown(doc.id);
}
