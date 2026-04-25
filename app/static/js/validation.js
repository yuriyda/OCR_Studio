// Валидация файлов перед загрузкой.
// Редактирование: граничное условие — строго `>` (файл ровно в лимит проходит, как и на бэке).

export function filterBySize(files, maxBytes, onTooLarge) {
  const max = maxBytes || (50 * 1024 * 1024);
  const tooLarge = files.filter(f => f.size > max);
  if (tooLarge.length && typeof onTooLarge === 'function') {
    onTooLarge(tooLarge, max);
  }
  return files.filter(f => f.size <= max);
}

export function formatTooLargeMessage(tooLarge, maxBytes) {
  const names = tooLarge.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`).join(', ');
  return `Слишком большие файлы (макс ${Math.round(maxBytes / 1024 / 1024)} MB): ${names}`;
}
