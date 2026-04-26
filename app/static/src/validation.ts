/**
 * Клиентская валидация файлов перед загрузкой.
 *
 * Редактирование:
 * - Граничное условие — строго `>` (файл ровно в лимит проходит, как и на бэке
 *   в `app/main.py: _check_size`). Не менять без правки backend.
 * - `filterBySize` — чистая функция: возвращает `ok`-список и вызывает callback
 *   с rejected. Не трогает DOM/toast — это слой выше (main.ts).
 * - `formatTooLargeMessage` — humanized RU-сообщение. Перевод на en появится
 *   в i18n bundle, эта функция останется RU-only fallback.
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
