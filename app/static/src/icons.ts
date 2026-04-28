/**
 * Map file extensions to emoji icons + helper for formatting sizes in bytes.
 *
 * Maintenance notes:
 * - When adding a new file type (e.g. a .docx source) — add to IMAGE_EXT
 *   or create a new Set and add a branch in iconForFilename.
 * - formatBytes is i18n-aware: unit suffix (B/KB/MB/GB vs Б/КБ/МБ/ГБ) comes
 *   from the active locale via t('units.*'). Unit thresholds are universal
 *   (binary 1024-step), only the suffix label is localised.
 * - The single dependency on i18n is a runtime call; no circular import risk
 *   because i18n.ts only imports from types.ts.
 */

import { t } from './i18n';

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
  if (bytes < 1024) return `${bytes} ${t('units.bytes')}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${t('units.kb')}`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} ${t('units.mb')}`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} ${t('units.gb')}`;
}
