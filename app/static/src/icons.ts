/**
 * Mapping расширений файлов на эмодзи-иконки + хелпер форматирования размеров в байтах.
 *
 * Редактирование:
 * - При добавлении нового типа файла (например, .docx исходник) — добавь в IMAGE_EXT
 *   или создай новый Set, добавь ветку в iconForFilename.
 * - formatBytes использует RU единицы (Б/КБ/МБ/ГБ). Не добавлять английские варианты —
 *   это не i18n-таблица, единицы безразмерны и общие.
 * - Не зависеть от других модулей (icons.ts — leaf utility).
 */

const PDF_EXT = new Set(['pdf']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'bmp', 'tiff', 'tif', 'webp', 'gif']);

export function iconForFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '📄';
  const ext = filename.slice(dot + 1).toLowerCase();
  if (PDF_EXT.has(ext)) return '📕';
  if (IMAGE_EXT.has(ext)) return '🖼';
  return '📄';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
}
