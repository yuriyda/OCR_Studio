/**
 * documents.js — модуль рендера списка документов и сортировки.
 *
 * Назначение: отвечает за отрисовку списка документов в боковой панели,
 * включая статус, прогресс обработки и выделение активного документа.
 *
 * Правила редактирования:
 * - Вся HTML-разметка элементов списка документов — только здесь.
 * - Не добавлять бизнес-логику загрузки/сохранения данных.
 * - STATUS_ICONS — единственный источник иконок статусов.
 */

const STATUS_ICONS = { queued: '⏳', processing: '⚙️', done: '✅', error: '❌' };

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/**
 * Отрисовывает список документов в переданный контейнер.
 * @param {HTMLElement} container — целевой DOM-элемент
 * @param {Array} docs — массив объектов документов
 * @param {string|null} activeId — id активного документа
 */
export function renderDocuments(container, docs, activeId) {
  if (!docs.length) {
    container.innerHTML = '<div class="empty-state">Перетащите файлы сюда</div>';
    return;
  }
  container.innerHTML = docs.map(d => {
    const active = d.id === activeId ? 'active' : '';
    let progress = '';
    if (d.status === 'processing') {
      if (d.progress_percent != null) {
        progress = `<div class="progress-bar"><div class="progress-fill" style="width:${d.progress_percent}%"></div></div>`;
      } else {
        progress = '<span class="spinner"></span>';
      }
    }
    const isProcessing = d.status === 'processing';
    const menuDisabled = isProcessing ? 'disabled' : '';
    const fmt = d.format ? `<span class="format-badge">${escHtml(d.format)}</span>` : '';
    return `
      <div class="doc-item ${active}" data-id="${d.id}" draggable="true">
        <span class="status-icon">${STATUS_ICONS[d.status] || ''}</span>
        <span class="filename">${escHtml(d.filename)}</span>
        ${fmt}
        ${progress}
        <span class="doc-menu ${menuDisabled}" data-id="${d.id}">⋮</span>
      </div>
    `;
  }).join('');
}

/**
 * Возвращает отсортированную копию массива документов.
 * @param {Array} docs — исходный массив (не мутируется)
 * @param {'name'|'size'|'created'} sort — поле сортировки
 * @param {'asc'|'desc'} order — направление
 * @returns {Array}
 */
export function applySort(docs, sort, order) {
  const cmp = {
    name: (a, b) => a.filename.localeCompare(b.filename),
    size: (a, b) => (a.size_bytes || 0) - (b.size_bytes || 0),
    created: (a, b) => a.created_at.localeCompare(b.created_at),
  }[sort] || (() => 0);
  const sorted = [...docs].sort(cmp);
  return order === 'desc' ? sorted.reverse() : sorted;
}
