// Модуль рендеринга секции проектов в sidebar.
// Отвечает за: построение списка проектов, пометку активного проекта,
// скрытие контекстного меню для системного проекта Inbox.
// Ограничения: разметка проектов — только здесь, не дублировать в других модулях.

export const INBOX_ID = 1;

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function renderProjects(container, projects, activeId) {
  container.innerHTML = projects.map(p => {
    const active = p.id === activeId ? 'active' : '';
    const menu = p.id === INBOX_ID ? '' : '<span class="proj-menu" data-id="' + p.id + '">⋮</span>';
    return `
      <div class="project-item ${active}" data-id="${p.id}">
        <span class="proj-name">📁 ${escHtml(p.name)}</span>
        <span class="proj-count">(${p.doc_count})</span>
        ${menu}
      </div>
    `;
  }).join('');
}
