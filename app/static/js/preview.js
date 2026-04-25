// Переключатель Source/Rendered и рендер preview.
// Редактирование:
// - Никакого client-side markdown/docx-парсинга.
// - innerHTML — только из api.getRendered(), backend гарантирует sanitization.

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export async function renderPreview(container, doc, mode, api) {
  if (!doc) {
    container.innerHTML = '<div class="empty-state">Выберите документ</div>';
    return;
  }
  if (mode === 'source') {
    if (doc.format === 'docx') {
      container.innerHTML = '<div class="empty-state">Source view недоступен для DOCX, откройте Rendered</div>';
      return;
    }
    const data = await api.getMarkdown(doc.id);
    container.innerHTML = `<pre>${escHtml(data.markdown)}</pre>`;
    return;
  }
  if (mode === 'rendered') {
    const data = await api.getRendered(doc.id);
    container.innerHTML = `<div class="rendered">${data.html}</div>`;
    return;
  }
}
