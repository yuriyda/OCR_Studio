/**
 * Точка входа frontend OCR Studio (Vite entry).
 *
 * Редактирование:
 * - Здесь только wiring и orchestration. Логика рендера/состояния — в отдельных модулях.
 * - Document.id — string (UUID hex); Project.id — number. Не путать!
 * - На i18n:changed нужен ре-рендер dynamic-узлов (projects/documents/statusbar/tabs);
 *   data-i18n атрибуты обрабатываются автоматически в loadLang() → applyI18nToDom().
 * - Polling переключается в fast mode когда есть processing документ.
 */

import './main.css';
import { api, ApiError } from './api';
import { state } from './state';
import { loadLang, applyI18nToDom, t } from './i18n';
import { renderProjects, INBOX_ID } from './projects';
import { renderDocuments, applySort } from './documents';
import { renderSourcePane } from './source';
import { renderResult, allResultTabs, TAB_TO_FORMAT, isTabAvailable, type ResultTabKey } from './preview';
import { renderStatusBar } from './statusbar';
import { handleDrop, startDocDrag } from './drag';
import { Polling } from './polling';
import { showMenu } from './menu';
import { modal } from './modal';
import { toast } from './toast';
import { getCopyText } from './clipboard';
import { filterBySize, formatTooLargeMessage } from './validation';
import { initSplitter } from './splitter';
import type { Document, Project, SystemInfo, ApiLimits, LangCode } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

let projectsCache: Project[] = [];
let docsCache: Document[] = [];
let selectedDocId: string | null = null;
let resultTab: ResultTabKey = 'markdown';
let selectedPageIdx = 0;
let envCache: SystemInfo = { gpu: null, cuda: null, vram_gb: null, engine_lang: null, engine_status: 'idle' };
let limitsCache: ApiLimits = { max_file_size_bytes: 50 * 1024 * 1024, allowed_extensions: [] };
const previewPagesCache = new Map<string, string[]>();

async function refreshLimits(): Promise<void> {
  try {
    limitsCache = await api.getLimits();
    const mb = Math.round(limitsCache.max_file_size_bytes / (1024 * 1024));
    $('dropzone-limits').textContent = t('sidebar.dropzone.limits', { mb });
  } catch { /* ignore */ }
}

function checkSize(files: File[]): File[] {
  return filterBySize(files, limitsCache.max_file_size_bytes, (tooLarge, max) => {
    toast.show(formatTooLargeMessage(tooLarge, max), 'error');
  });
}

async function refreshProjects(): Promise<void> {
  projectsCache = await api.listProjects();
  renderProjects($('proj-list'), projectsCache, state.activeProjectId);
}

async function refreshDocuments(): Promise<void> {
  const { sort, order } = state.sortMode;
  const docs = await api.listDocuments(state.activeProjectId, sort, order);
  docsCache = applySort(docs, sort, order);
  renderDocuments($('doc-list'), docsCache, selectedDocId);
  refreshStatusBar();
  refreshRecognizeButton();
}

async function refreshSystem(): Promise<void> {
  envCache = await api.getSystemInfo();
  refreshStatusBar();
}

function refreshStatusBar(): void {
  const proj = projectsCache.find(p => p.id === state.activeProjectId);
  const processing = docsCache.filter(d => d.status === 'processing').length;
  const queued = docsCache.filter(d => d.status === 'queued').length;
  renderStatusBar($('statusbar'), {
    env: { gpu: envCache.gpu, cuda: envCache.cuda, vram_gb: envCache.vram_gb },
    engine: { name: 'PPStructureV3', lang: envCache.engine_lang, status: envCache.engine_status },
    project: proj ? { name: proj.name, doc_count: proj.doc_count, total_bytes: proj.total_bytes, processing, queued } : null,
  });
}

function refreshRecognizeButton(): void {
  const queued = docsCache.filter(d => d.status === 'queued').length;
  const processing = docsCache.filter(d => d.status === 'processing').length;
  const btn = $<HTMLButtonElement>('recognize-btn');
  const counter = $('recognize-counter');
  const labelEl = btn.querySelector('span[data-i18n]') as HTMLElement | null;
  if (processing > 0) {
    btn.classList.add('processing');
    btn.disabled = true;
    if (labelEl) labelEl.textContent = t('header.recognize.processing');
    counter.textContent = '';
  } else {
    btn.classList.remove('processing');
    btn.disabled = queued === 0;
    if (labelEl) labelEl.textContent = t('header.recognize');
    counter.textContent = ` · ${queued}`;
  }
}

async function loadPagePreviews(docId: string): Promise<void> {
  if (previewPagesCache.has(docId)) return;
  try {
    const data = await api.getPreview(docId);
    previewPagesCache.set(docId, data.pages);
  } catch { /* ignore */ }
}

async function selectDocument(docId: string): Promise<void> {
  if (selectedDocId !== docId) selectedPageIdx = 0;
  selectedDocId = docId;
  const doc = docsCache.find(d => d.id === docId) ?? null;
  if (doc) {
    if (doc.status === 'done') {
      // Дефолт — markdown, если доступен; иначе первый доступный таб.
      const tabs = allResultTabs();
      if (isTabAvailable('markdown', doc.available_formats)) {
        resultTab = 'markdown';
      } else {
        const firstAvailable = tabs.find(tab => isTabAvailable(tab.key, doc.available_formats));
        if (firstAvailable) resultTab = firstAvailable.key;
      }
    }
    await loadPagePreviews(docId);
    rerenderSource();
    renderResultTabs();
    await rerenderResult();
  }
}

function rerenderSource(): void {
  const doc = docsCache.find(d => d.id === selectedDocId) ?? null;
  const pages = selectedDocId !== null ? previewPagesCache.get(selectedDocId) ?? null : null;
  renderSourcePane($('source-thumbs'), $('source-large'), doc, pages, selectedPageIdx);
}

function renderResultTabs(): void {
  const doc = docsCache.find(d => d.id === selectedDocId);
  const container = $('result-tabs');
  if (!doc) {
    container.innerHTML = '';
    return;
  }
  const tabs = allResultTabs();
  container.innerHTML = tabs.map(tab => {
    const available = isTabAvailable(tab.key, doc.available_formats);
    const active = tab.key === resultTab ? 'border-accent text-text bg-accent/10' : 'border-transparent text-text-muted';
    const disabledCls = !available ? 'opacity-30 cursor-not-allowed' : '';
    const titleAttr = !available ? `title="${t('preview.source_unavailable')}"` : '';
    return `<button class="px-3 py-1.5 rounded-t border-b-2 ${active} ${disabledCls}" data-tab="${tab.key}" ${!available ? 'disabled' : ''} ${titleAttr}>${tab.label}</button>`;
  }).join('');
  container.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      resultTab = btn.dataset.tab as ResultTabKey;
      renderResultTabs();
      rerenderResult();
    });
  });
}

async function rerenderResult(): Promise<void> {
  const doc = docsCache.find(d => d.id === selectedDocId) ?? null;
  await renderResult($('result-area'), doc, resultTab, api);
}

const polling = new Polling(async (pid) => {
  try {
    const docs = await api.listDocuments(pid, state.sortMode.sort, state.sortMode.order);
    docsCache = applySort(docs, state.sortMode.sort, state.sortMode.order);
    renderDocuments($('doc-list'), docsCache, selectedDocId);
    refreshStatusBar();
    refreshRecognizeButton();
    if (docs.some(d => d.status === 'processing')) polling.enableFast();
    else polling.disableFast();
    if (polling.shouldStop(docs)) polling.stop();
  } catch { /* ignore */ }
}, 2000);

async function uploadFiles(filesList: File[], pid: number): Promise<void> {
  try {
    const resp = await api.uploadDocs(filesList, pid);
    for (const w of resp.warnings) {
      const file = filesList.find(_f => true);
      toast.show(t('warning.long_processing', { file: file?.name ?? '?', pages: w.pages }), 'info');
    }
    await refreshProjects();
    await refreshDocuments();
  } catch (e) {
    toast.show((e as Error).message, 'error');
  }
}

function bindUI(): void {
  $('proj-list').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>('.project-item');
    if (!item) return;
    const projId = Number(item.dataset.id);
    if (target.classList.contains('proj-menu')) { handleProjectMenu(projId); return; }
    state.setActiveProject(projId);
    refreshProjects(); refreshDocuments();
    polling.setProject(state.activeProjectId);
  });

  $('proj-list').addEventListener('dragover', (e) => {
    if ((e.target as HTMLElement).closest('.project-item')) e.preventDefault();
  });
  $('proj-list').addEventListener('drop', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.project-item');
    if (!item) return;
    const projId = Number(item.dataset.id);
    handleDrop(e as DragEvent, projId, {
      onUpload: (files, pid) => { const ok = checkSize(files); if (ok.length) uploadFiles(ok, pid); },
      onMove: async (docId, pid) => { await api.moveDocument(docId, pid); await refreshProjects(); await refreshDocuments(); },
    });
  });

  $('proj-add-btn').addEventListener('click', async () => {
    const name = await modal.prompt(t('modal.project.create'));
    if (!name) return;
    try { await api.createProject(name); await refreshProjects(); }
    catch (e) { toast.show((e as Error).message, 'error'); }
  });

  $('doc-list').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>('.doc-item');
    if (!item || !item.dataset.id) return;
    if (target.classList.contains('doc-menu')) {
      if (!target.classList.contains('disabled')) handleDocMenu(item.dataset.id);
      return;
    }
    selectDocument(item.dataset.id);
  });
  $('doc-list').addEventListener('dragstart', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.doc-item');
    if (item && item.dataset.id) startDocDrag(e as DragEvent, item.dataset.id);
  });

  $('sort-select').addEventListener('change', () => {
    const [sort, order] = ($('sort-select') as HTMLSelectElement).value.split('-');
    state.setSortMode(sort as 'created' | 'name' | 'size', order as 'asc' | 'desc');
    refreshDocuments();
  });

  $('ui-lang-select').addEventListener('change', () => {
    const newLang = ($('ui-lang-select') as HTMLSelectElement).value as LangCode;
    state.setUiLang(newLang);
    loadLang(newLang);
    renderProjects($('proj-list'), projectsCache, state.activeProjectId);
    renderDocuments($('doc-list'), docsCache, selectedDocId);
    refreshStatusBar();
    refreshRecognizeButton();
    renderResultTabs();
  });

  $('source-thumbs').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const thumb = target.closest<HTMLElement>('.source-thumb');
    if (!thumb || !thumb.dataset.pageIdx) return;
    selectedPageIdx = Number(thumb.dataset.pageIdx);
    rerenderSource();
  });

  const dropzone = $('dropzone');
  const fileInput = $<HTMLInputElement>('file-input');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) {
      const files = checkSize(Array.from(fileInput.files));
      if (files.length) uploadFiles(files, state.activeProjectId);
    }
    fileInput.value = '';
  });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('border-accent'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('border-accent'));
  dropzone.addEventListener('drop', (e) => {
    dropzone.classList.remove('border-accent');
    handleDrop(e as DragEvent, state.activeProjectId, {
      onUpload: (files, pid) => { const ok = checkSize(files); if (ok.length) uploadFiles(ok, pid); },
      onMove: async () => { /* dropzone не принимает перемещения документов */ },
    });
  });

  $('recognize-btn').addEventListener('click', async () => {
    const pid = state.activeProjectId;
    try {
      const r = await api.recognizeProject(pid);
      if (r.started > 0) polling.start();
    } catch (e) { toast.show((e as Error).message, 'error'); }
  });

  $('download-btn').addEventListener('click', () => {
    if (selectedDocId === null) return;
    const fmt = TAB_TO_FORMAT[resultTab];
    window.open(api.resultUrl(selectedDocId, fmt), '_blank');
  });

  $('copy-btn').addEventListener('click', async () => {
    if (selectedDocId === null) return;
    const doc = docsCache.find(d => d.id === selectedDocId);
    try {
      const text = await getCopyText(doc, api);
      if (!navigator.clipboard) { toast.show(t('toast.clipboard_unavailable'), 'error'); return; }
      await navigator.clipboard.writeText(text);
      toast.show(t('toast.copied'), 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
  });

  $('batch-zip-btn').addEventListener('click', () => {
    window.open(api.projectZipUrl(state.activeProjectId), '_blank');
  });
}

function handleProjectMenu(id: number): void {
  const proj = projectsCache.find(p => p.id === id);
  if (!proj) return;
  const anchor = document.querySelector<HTMLElement>(`.project-item[data-id="${id}"] .proj-menu`);
  if (!anchor) return;
  showMenu(anchor, [
    {
      label: t('menu.rename'),
      action: async () => {
        const newName = await modal.prompt(t('modal.project.rename'), proj.name);
        if (!newName || newName === proj.name) return;
        try { await api.renameProject(id, newName); await refreshProjects(); }
        catch (e) { toast.show((e as Error).message, 'error'); }
      },
    },
    {
      label: t('menu.delete_project'),
      danger: true,
      action: async () => {
        const ok = await modal.confirm(t('menu.delete_project'),
          t('modal.confirm.delete_project', { name: proj.name, count: proj.doc_count }));
        if (!ok) return;
        try {
          await api.deleteProject(id);
          if (state.activeProjectId === id) state.setActiveProject(INBOX_ID);
          await refreshProjects(); await refreshDocuments();
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) toast.show(t('toast.processing_required'), 'error');
          else toast.show((e as Error).message, 'error');
        }
      },
    },
  ]);
}

function handleDocMenu(docId: string): void {
  const doc = docsCache.find(d => d.id === docId);
  if (!doc) return;
  const anchor = document.querySelector<HTMLElement>(`.doc-item[data-id="${docId}"] .doc-menu`);
  if (!anchor) return;
  const moveItems = projectsCache.filter(p => p.id !== doc.project_id).map(p => ({
    label: t('menu.move_to', { name: p.name }),
    action: async () => { await api.moveDocument(docId, p.id); await refreshProjects(); await refreshDocuments(); },
  }));
  showMenu(anchor, [...moveItems, {
    label: t('menu.delete'),
    danger: true,
    action: async () => {
      const ok = await modal.confirm(t('menu.delete'), t('modal.confirm.delete_doc', { name: doc.filename }));
      if (!ok) return;
      try {
        await api.deleteDocument(docId);
        if (selectedDocId === docId) selectedDocId = null;
        await refreshDocuments();
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) toast.show(t('toast.processing_required'), 'error');
        else toast.show((e as Error).message, 'error');
      }
    },
  }]);
}

async function boot(): Promise<void> {
  state.load();
  loadLang(state.uiLang);
  ($('ui-lang-select') as HTMLSelectElement).value = state.uiLang;
  applyI18nToDom();

  initSplitter(
    [$('pane-sidebar'), $('pane-source'), $('pane-result')],
    [...state.panelSizes],
    (sizes) => {
      if (sizes.length === 3) {
        state.setPanelSizes([sizes[0]!, sizes[1]!, sizes[2]!]);
      }
    },
  );

  bindUI();
  await refreshSystem();
  await refreshProjects();
  polling.setProject(state.activeProjectId);
  await refreshDocuments();
  polling.start();
  await refreshLimits();
}

boot();
