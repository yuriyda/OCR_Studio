// Точка входа frontend.
// Редактирование: только подключение модулей и обработчики верхнего уровня.

import { api } from './api.js';
import { state } from './state.js';
import { renderProjects, INBOX_ID } from './projects.js';
import { renderDocuments, applySort } from './documents.js';
import { handleDrop, startDocDrag } from './drag.js';
import { Polling } from './polling.js';
import { renderPreview } from './preview.js';
import { renderStatusBar } from './statusbar.js';
import { showMenu } from './menu.js';
import { getCopyText } from './clipboard.js';
import { filterBySize, formatTooLargeMessage } from './validation.js';
import { toast } from './toast.js';

async function getCopyTextForDoc(docId) {
  const doc = docsCache.find(d => d.id === docId);
  return getCopyText(doc, api);
}

const $ = (id) => document.getElementById(id);
let projectsCache = [];
let docsCache = [];
let selectedDocId = null;
let previewMode = 'pages';
let selectedPageIdx = 0;
let envCache = { gpu: null, cuda: null, vram_gb: null };
let limitsCache = { max_file_size_bytes: 50 * 1024 * 1024 };

async function refreshLimits() {
  try {
    limitsCache = await api.getLimits();
    const mb = Math.round(limitsCache.max_file_size_bytes / (1024 * 1024));
    $('dropzone-limits').textContent = `Максимум ${mb} MB на файл`;
  } catch {}
}

function checkSize(files) {
  return filterBySize(files, limitsCache.max_file_size_bytes, (tooLarge, max) => {
    toast.show(formatTooLargeMessage(tooLarge, max), 'error');
  });
}

async function refreshProjects() {
  projectsCache = await api.listProjects();
  renderProjects($('proj-list'), projectsCache, state.activeProjectId);
}

async function refreshDocuments() {
  const { sort, order } = state.sortMode;
  docsCache = await api.listDocuments(state.activeProjectId, sort, order);
  docsCache = applySort(docsCache, sort, order);
  renderDocuments($('doc-list'), docsCache, selectedDocId);
  refreshStatusBar();
}

async function refreshSystem() {
  const info = await api.getSystemInfo();
  envCache = { gpu: info.gpu, cuda: info.cuda, vram_gb: info.vram_gb };
  refreshStatusBar(info);
}

function refreshStatusBar(systemInfo) {
  const proj = projectsCache.find(p => p.id === state.activeProjectId);
  const processing = docsCache.filter(d => d.status === 'processing').length;
  const queued = docsCache.filter(d => d.status === 'queued').length;
  renderStatusBar($('statusbar'), {
    env: envCache,
    engine: {
      name: 'PPStructureV3',
      lang: systemInfo ? systemInfo.engine_lang : (proj ? null : null),
      status: systemInfo ? systemInfo.engine_status : 'ready',
    },
    project: proj ? {
      name: proj.name,
      doc_count: proj.doc_count,
      total_bytes: proj.total_bytes,
      processing,
      queued,
    } : null,
  });
}

const previewPagesCache = new Map(); // docId → { pages: [b64...] }

async function loadPagePreviews(docId) {
  const bar = $('preview-bar');
  if (!docId) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  bar.style.display = 'flex';
  if (previewPagesCache.has(docId)) {
    renderThumbnailBar(docId);
    return;
  }
  bar.innerHTML = '<span class="spinner"></span>';
  try {
    const data = await api.getPreview(docId);
    previewPagesCache.set(docId, { pages: data.pages });
    if (selectedDocId === docId) renderThumbnailBar(docId);
  } catch {
    if (selectedDocId === docId) {
      bar.innerHTML = '<span style="color:var(--text2);font-size:0.8rem;">Превью недоступно</span>';
    }
  }
}

function renderThumbnailBar(docId) {
  const bar = $('preview-bar');
  const cached = previewPagesCache.get(docId);
  if (!cached) { bar.innerHTML = ''; return; }
  bar.innerHTML = cached.pages.map((b64, i) => {
    const sel = i === selectedPageIdx ? 'selected' : '';
    return `<img class="${sel}" data-idx="${i}" src="data:image/jpeg;base64,${b64}" alt="Page ${i+1}" title="Page ${i+1}">`;
  }).join('');
}

async function selectDocument(docId) {
  if (selectedDocId !== docId) {
    selectedPageIdx = 0;
  }
  selectedDocId = docId;
  await loadPagePreviews(docId);
  await rerenderResultArea();
}

async function rerenderResultArea() {
  const doc = docsCache.find(d => d.id === selectedDocId);
  let pageData = null;
  if (previewMode === 'pages' && selectedDocId) {
    const cached = previewPagesCache.get(selectedDocId);
    if (cached) pageData = { pages: cached.pages, selectedIdx: selectedPageIdx };
  }
  await renderPreview($('result-area'), doc, previewMode, api, pageData);
  $('tab-pages').classList.toggle('active', previewMode === 'pages');
  $('tab-source').classList.toggle('active', previewMode === 'source');
  $('tab-rendered').classList.toggle('active', previewMode === 'rendered');
}

const polling = new Polling(async (pid) => {
  const docs = await api.listDocuments(pid, state.sortMode.sort, state.sortMode.order);
  docsCache = applySort(docs, state.sortMode.sort, state.sortMode.order);
  renderDocuments($('doc-list'), docsCache, selectedDocId);
  refreshStatusBar();
  if (polling.shouldStop(docs)) polling.stop();
}, 2000);

function bindUI() {
  $('proj-list').addEventListener('click', (e) => {
    const item = e.target.closest('.project-item');
    if (!item) return;
    if (e.target.classList.contains('proj-menu')) {
      handleProjectMenu(Number(item.dataset.id));
      return;
    }
    state.setActiveProject(Number(item.dataset.id));
    refreshProjects();
    refreshDocuments();
    polling.setProject(state.activeProjectId);
  });

  $('proj-list').addEventListener('dragover', (e) => {
    if (e.target.closest('.project-item')) e.preventDefault();
  });
  $('proj-list').addEventListener('drop', (e) => {
    const item = e.target.closest('.project-item');
    if (!item) return;
    handleDrop(e, Number(item.dataset.id), {
      onUpload: (files, pid) => {
        const ok = checkSize(files);
        if (ok.length) uploadFiles(ok, pid);
      },
      onMove: async (docId, pid) => {
        await api.moveDocument(docId, pid);
        refreshProjects();
        refreshDocuments();
      },
    });
  });

  $('proj-add-btn').addEventListener('click', async () => {
    const name = prompt('Имя нового проекта');
    if (!name) return;
    try {
      await api.createProject(name);
      refreshProjects();
    } catch (e) {
      toast.show(e.message, 'error');
    }
  });

  $('doc-list').addEventListener('click', (e) => {
    const item = e.target.closest('.doc-item');
    if (!item) return;
    if (e.target.classList.contains('doc-menu')) {
      if (!e.target.classList.contains('disabled')) handleDocMenu(item.dataset.id);
      return;
    }
    selectDocument(item.dataset.id);
  });
  $('doc-list').addEventListener('dragstart', (e) => {
    const item = e.target.closest('.doc-item');
    if (item) startDocDrag(e, item.dataset.id);
  });

  $('sort-select').addEventListener('change', () => {
    const [sort, order] = $('sort-select').value.split('-');
    state.setSortMode(sort, order);
    refreshDocuments();
  });

  $('tab-pages').addEventListener('click', () => { previewMode = 'pages'; rerenderResultArea(); });
  $('tab-source').addEventListener('click', () => { previewMode = 'source'; rerenderResultArea(); });
  $('tab-rendered').addEventListener('click', () => { previewMode = 'rendered'; rerenderResultArea(); });

  $('preview-bar').addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG' && e.target.dataset.idx != null) {
      selectedPageIdx = Number(e.target.dataset.idx);
      previewMode = 'pages';
      renderThumbnailBar(selectedDocId);
      rerenderResultArea();
    }
  });

  $('lang-select').addEventListener('change', () => refreshSystem());

  const dropzone = $('dropzone');
  const fileInput = $('file-input');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      const files = checkSize(Array.from(fileInput.files));
      if (files.length) uploadFiles(files, state.activeProjectId);
    }
    fileInput.value = '';
  });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    dropzone.classList.remove('drag-over');
    handleDrop(e, state.activeProjectId, {
      onUpload: (files, pid) => {
        const ok = checkSize(files);
        if (ok.length) uploadFiles(ok, pid);
      },
      onMove: async () => {},
    });
  });

  $('download-btn').addEventListener('click', () => {
    if (selectedDocId) window.open(`/api/result/${selectedDocId}`, '_blank');
  });

  $('copy-btn').addEventListener('click', async () => {
    if (!selectedDocId) return;
    try {
      const text = await getCopyTextForDoc(selectedDocId);
      if (!navigator.clipboard) {
        toast.show('Буфер обмена недоступен (требуется HTTPS или localhost)', 'error');
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.show('Скопировано', 'success');
    } catch (e) {
      toast.show('Не удалось скопировать: ' + e.message, 'error');
    }
  });

  $('batch-zip-btn').addEventListener('click', () => {
    const pid = state.activeProjectId;
    if (pid != null) window.open(api.projectZipUrl(pid), '_blank');
  });
}

async function uploadFiles(filesList, pid) {
  await api.uploadDocs(filesList, $('format-select').value, $('lang-select').value, pid);
  refreshProjects();
  refreshDocuments();
  polling.start();
}

function handleProjectMenu(id) {
  const proj = projectsCache.find(p => p.id === id);
  if (!proj) return;
  const anchor = document.querySelector(`.project-item[data-id="${id}"] .proj-menu`);
  if (!anchor) return;
  showMenu(anchor, [
    {
      label: 'Переименовать',
      action: async () => {
        const newName = prompt('Новое имя проекта', proj.name);
        if (!newName || newName === proj.name) return;
        try {
          await api.renameProject(id, newName);
          refreshProjects();
        } catch (e) {
          toast.show(e.message, 'error');
        }
      },
    },
    {
      label: 'Удалить проект',
      danger: true,
      action: async () => {
        if (!confirm(`Удалить проект "${proj.name}" и все его документы (${proj.doc_count} шт.)?`)) return;
        try {
          await api.deleteProject(id);
          if (state.activeProjectId === id) state.setActiveProject(INBOX_ID);
          refreshProjects();
          refreshDocuments();
        } catch (e) {
          if (e.status === 409) toast.show('Дождитесь завершения обработки', 'error');
          else toast.show(e.message, 'error');
        }
      },
    },
  ]);
}

function handleDocMenu(docId) {
  const doc = docsCache.find(d => d.id === docId);
  if (!doc) return;
  const anchor = document.querySelector(`.doc-item[data-id="${docId}"] .doc-menu`);
  if (!anchor) return;
  const moveItems = projectsCache
    .filter(p => p.id !== doc.project_id)
    .map(p => ({
      label: `Переместить → ${p.name}`,
      action: async () => {
        await api.moveDocument(docId, p.id);
        refreshProjects();
        refreshDocuments();
      },
    }));
  showMenu(anchor, [
    ...moveItems,
    {
      label: 'Удалить',
      danger: true,
      action: async () => {
        if (!confirm(`Удалить "${doc.filename}"?`)) return;
        try {
          await api.deleteDocument(docId);
          if (selectedDocId === docId) selectedDocId = null;
          refreshDocuments();
        } catch (e) {
          if (e.status === 409) toast.show('Дождитесь завершения обработки', 'error');
          else toast.show(e.message, 'error');
        }
      },
    },
  ]);
}

state.load();
bindUI();
refreshSystem();
refreshProjects().then(() => {
  polling.setProject(state.activeProjectId);
  refreshDocuments();
  polling.start();
});
refreshLimits();
