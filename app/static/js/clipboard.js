// Подготовка текста для копирования в буфер обмена.
// Редактирование: для docx обязательно сохранять переносы строк между блочными элементами.

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);

function htmlToPlainText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  // Заменить <br> на \n
  tmp.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  // После каждого блочного элемента добавить \n
  tmp.querySelectorAll('*').forEach(el => {
    if (BLOCK_TAGS.has(el.tagName)) el.append('\n');
  });
  // Между ячейками таблицы — табуляция
  tmp.querySelectorAll('th, td').forEach(cell => cell.append('\t'));
  return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export async function getCopyText(doc, api) {
  if (!doc) return '';
  if (doc.format === 'docx') {
    const data = await api.getRendered(doc.id);
    return htmlToPlainText(data.html || '');
  }
  const data = await api.getMarkdown(doc.id);
  return data.markdown || '';
}
