// Переключатель Pages/Source/Rendered и рендер preview.
// Редактирование:
// - Никакого client-side markdown/docx-парсинга.
// - innerHTML — только из api.getRendered(), backend гарантирует sanitization.

export async function renderPreview(container, doc, mode, api, pageData = null) {
  if (!doc) {
    container.innerHTML = '<div class="empty-state">Выберите документ</div>';
    return;
  }
  if (mode === 'pages') {
    if (!pageData || !pageData.pages || !pageData.pages.length) {
      container.innerHTML = '<div class="empty-state">Превью страниц недоступно</div>';
      return;
    }
    const idx = pageData.selectedIdx || 0;
    const safeIdx = Math.max(0, Math.min(idx, pageData.pages.length - 1));
    container.innerHTML = `<img class="page-large" src="data:image/jpeg;base64,${pageData.pages[safeIdx]}" alt="Page ${safeIdx + 1}">`;
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

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
