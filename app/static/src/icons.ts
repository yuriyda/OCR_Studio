/**
 * Map file extensions to emoji icons + helper for formatting sizes in bytes.
 *
 * Maintenance notes:
 * - When adding a new file type (e.g. a .docx source) — add to IMAGE_EXT
 *   or create a new Set and add a branch in iconForFilename.
 * - formatBytes uses RU units (Б/КБ/МБ/ГБ). Do not add English variants —
 *   this is not an i18n table; the units are dimensionless and universal.
 * - No dependencies on other modules (icons.ts is a leaf utility).
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
