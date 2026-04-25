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

const $ = (id) => document.getElementById(id);
let projectsCache = [];
let docsCache = [];
let selectedDocId = null;
let previewMode = 'source';
let envCache = { gpu: null, cuda: null, vram_gb: null };

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

const previewPagesCache = new Map();

async function loadPagePreviews(docId) {
  const bar = $('preview-bar');
  if (!docId) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  bar.style.display = 'flex';
  if (previewPagesCache.has(docId)) {
    bar.innerHTML = previewPagesCache.get(docId);
    return;
  }
  bar.innerHTML = '<span class="spinner"></span>';
  try {
    const data = await api.getPreview(docId);
    const html = data.pages.map((b64, i) =>
      `<img src="data:image/jpeg;base64,${b64}" alt="Page ${i+1}" title="Page ${i+1}">`
    ).join('');
    previewPagesCache.set(docId, html);
    bar.innerHTML = html;
  } catch {
    bar.innerHTML = '<span style="color:var(--text2);font-size:0.8rem;">Превью недоступно</span>';
  }
}

async function selectDocument(docId) {
  selectedDocId = docId;
  const doc = docsCache.find(d => d.id === docId);
  loadPagePreviews(docId);
  await renderPreview($('result-area'), doc, previewMode, api);
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
      onUpload: (files, pid) => uploadFiles(files, pid),
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
      alert(e.message);
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

  $('tab-source').addEventListener('click', () => { previewMode = 'source'; selectDocument(selectedDocId); });
  $('tab-rendered').addEventListener('click', () => { previewMode = 'rendered'; selectDocument(selectedDocId); });

  const dropzone = $('dropzone');
  const fileInput = $('file-input');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) uploadFiles(fileInput.files, state.activeProjectId);
    fileInput.value = '';
  });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    dropzone.classList.remove('drag-over');
    handleDrop(e, state.activeProjectId, {
      onUpload: (files, pid) => uploadFiles(files, pid),
      onMove: async () => {},
    });
  });

  $('download-btn').addEventListener('click', () => {
    if (selectedDocId) window.open(`/api/result/${selectedDocId}`, '_blank');
  });

  $('copy-btn').addEventListener('click', async () => {
    if (!selectedDocId) return;
    try {
      let text;
      const doc = docsCache.find(d => d.id === selectedDocId);
      if (doc && doc.format === 'docx') {
        const data = await api.getRendered(selectedDocId);
        const tmp = document.createElement('div');
        tmp.innerHTML = data.html;
        text = tmp.textContent || '';
      } else {
        const data = await api.getMarkdown(selectedDocId);
        text = data.markdown || '';
      }
      await navigator.clipboard.writeText(text);
      const toast = $('copy-toast');
      toast.style.display = 'inline';
      setTimeout(() => { toast.style.display = 'none'; }, 1500);
    } catch (e) {
      alert('Не удалось скопировать: ' + e.message);
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

async function handleProjectMenu(id) {
  const action = prompt('Действие: rename | delete', 'rename');
  if (action === 'rename') {
    const newName = prompt('Новое имя');
    if (newName) {
      try { await api.renameProject(id, newName); refreshProjects(); }
      catch (e) { alert(e.message); }
    }
  } else if (action === 'delete') {
    const proj = projectsCache.find(p => p.id === id);
    if (confirm(`Удалить проект "${proj.name}" и все его документы (${proj.doc_count} шт.)?`)) {
      try {
        await api.deleteProject(id);
        if (state.activeProjectId === id) state.setActiveProject(INBOX_ID);
        refreshProjects();
        refreshDocuments();
      } catch (e) {
        if (e.status === 409) alert('Дождитесь завершения обработки');
        else alert(e.message);
      }
    }
  }
}

async function handleDocMenu(docId) {
  const action = prompt('Действие: move | delete', 'move');
  if (action === 'move') {
    const targetName = prompt(`Целевой проект (${projectsCache.map(p => p.name).join(', ')})`);
    const target = projectsCache.find(p => p.name === targetName);
    if (target) {
      await api.moveDocument(docId, target.id);
      refreshProjects();
      refreshDocuments();
    }
  } else if (action === 'delete') {
    const doc = docsCache.find(d => d.id === docId);
    if (confirm(`Удалить "${doc.filename}"?`)) {
      try {
        await api.deleteDocument(docId);
        if (selectedDocId === docId) selectedDocId = null;
        refreshDocuments();
      } catch (e) {
        if (e.status === 409) alert('Дождитесь завершения обработки');
        else alert(e.message);
      }
    }
  }
}

state.load();
bindUI();
refreshSystem();
refreshProjects().then(() => {
  polling.setProject(state.activeProjectId);
  refreshDocuments();
  polling.start();
});
