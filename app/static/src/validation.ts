/**
 * Client-side file validation before upload.
 *
 * Maintenance notes:
 * - Boundary condition — strictly `>` (a file exactly at the limit passes, same as the backend
 *   in `app/main.py: _check_size`). Do not change without updating the backend.
 * - `filterBySize` — pure function: returns the `ok` list and calls the callback
 *   with rejected files. Does not touch DOM/toast — that is the responsibility of the layer above (main.ts).
 * - `formatTooLargeMessage` — humanized RU message. An EN translation will appear
 *   in the i18n bundle; this function will remain as a RU-only fallback.
 */

export function filterBySize(
  files: File[],
  maxBytes: number,
  onTooLarge: (tooLarge: File[], max: number) => void,
): File[] {
  const ok: File[] = [];
  const tooLarge: File[] = [];
  for (const f of files) {
    if (f.size > maxBytes) tooLarge.push(f);
    else ok.push(f);
  }
  if (tooLarge.length) onTooLarge(tooLarge, maxBytes);
  return ok;
}

export function formatTooLargeMessage(tooLarge: File[], maxBytes: number): string {
  const mb = Math.round(maxBytes / (1024 * 1024));
  const names = tooLarge.map((f) => f.name).join(', ');
  return `Файлы превышают ${mb} МБ: ${names}`;
}
