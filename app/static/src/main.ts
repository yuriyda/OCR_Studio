/**
 * Frontend entry point for OCR Studio (Vite entry).
 *
 * Maintenance notes:
 * - Only wiring and orchestration here. Render/state logic lives in separate modules.
 * - Document.id — string (UUID hex); Project.id — number. Do not mix them up!
 * - On i18n:changed, dynamic nodes (projects/documents/statusbar/tabs) need a re-render;
 *   data-i18n attributes are handled automatically by loadLang() → applyI18nToDom().
 * - Polling switches to fast mode when there is a processing document.
 */

import './main.css';
import { api, ApiError, getSettings, reocrDoc, reocrProject } from './api';
import { state } from './state';
import { loadLang, applyI18nToDom, t } from './i18n';
import { renderProjects, INBOX_ID, isProtectedProject } from './projects';
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
import { openSettingsModal } from './settings_modal';
import { showReloadModal, hideReloadModal } from './reload_modal';
import { renderHqIndicator } from './render';
import { isAnyHqActive, getBatch, setBatch } from './state';
import { updateBatch } from './batch_tracker';
import type { Document, Project, SystemInfo, ApiLimits, LangCode } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

let projectsCache: Project[] = [];
let docsCache: Document[] = [];
let selectedDocId: string | null = null;
let resultTab: ResultTabKey = 'markdown';
let selectedPageIdx = 0;
let envCache: SystemInfo = {
  gpu: null, cuda: null, vram_gb: null, engine_lang: null, engine_status: 'idle', engine_pipeline: [],
  recommendation: { hq_mode: 'off', reason: '', warning: null },
  queue: { queued: 0, processing: 0, completed_since_start: 0, current: null },
};
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

const SYSTEM_POLL_ACTIVE_MS = 2000;
const SYSTEM_POLL_IDLE_MS = 10000;

async function pollSystemState(): Promise<void> {
  try {
    envCache = await api.getSystemInfo();
    // Store the GPU-based HQ recommendation so settings_modal can display it.
    if (envCache.recommendation) {
      state.setRecommendation(envCache.recommendation);
    }
    setBatch(updateBatch(getBatch(), envCache.queue, Date.now()));
    // When the global queue is active, force-restart the document poller in
    // case shouldStop() killed it earlier on an empty project (e.g., Watch
    // project receives a new doc from the inbox watcher while the user has
    // it open). polling.start() is idempotent — restart resets the timer but
    // does not cause duplicate fetches.
    // Also refresh the projects sidebar so per-project count/size counters
    // (especially Watch) reflect ongoing ingest in real time. Errors are
    // swallowed by the outer try/catch — the next tick will retry.
    if (getBatch().active) {
      polling.start();
      refreshProjects();
    }
    refreshStatusBar();
  } catch {
    // Transient network error — keep previous state, just reschedule.
  } finally {
    const interval = getBatch().active ? SYSTEM_POLL_ACTIVE_MS : SYSTEM_POLL_IDLE_MS;
    setTimeout(pollSystemState, interval);
  }
}

function refreshStatusBar(): void {
  const proj = projectsCache.find(p => p.id === state.activeProjectId);
  const processing = docsCache.filter(d => d.status === 'processing').length;
  const queued = docsCache.filter(d => d.status === 'queued').length;
  const batch = getBatch();
  const elapsedMs = batch.active && batch.startTime !== null ? Date.now() - batch.startTime : 0;
  const remaining = Math.max(0, batch.totalInBatch - batch.completedInBatch);
  // Guard: skip ETA when no remaining work (avoids rendering "~ETA 0s" on last doc).
  const etaMs = batch.active
    && batch.completedInBatch > 0
    && remaining > 0
    && elapsedMs > 0
      ? (elapsedMs / batch.completedInBatch) * remaining
      : null;
  renderStatusBar($('statusbar'), {
    env: { gpu: envCache.gpu, cuda: envCache.cuda, vram_gb: envCache.vram_gb },
    engine: { name: 'PPStructureV3', lang: envCache.engine_lang, status: envCache.engine_status, pipeline: envCache.engine_pipeline },
    project: proj ? { name: proj.name, doc_count: proj.doc_count, total_bytes: proj.total_bytes, processing, queued } : null,
    queue: {
      active: batch.active,
      completedInBatch: batch.completedInBatch,
      totalInBatch: batch.totalInBatch,
      activeNow: batch.activeNow,
      elapsedMs,
      etaMs,
      lastSummary: batch.lastSummary,
      current: envCache.queue.current,
    },
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

async function loadPagePreviews(
  docId: string,
  onProgress?: (cur: number, total: number) => void,
): Promise<void> {
  if (previewPagesCache.has(docId)) return;
  // Concurrently with the blocking /thumbs call, poll /info to catch
  // _preview_progress (see preview_render.render_thumbs). Backend starts
  // rendering AFTER receiving GET /thumbs — add ~150 ms delay before the first
  // poll to avoid the window where progress=null.
  let pollTimer: number | null = null;
  let stopped = false;
  const startPolling = () => {
    pollTimer = window.setInterval(async () => {
      if (stopped) return;
      try {
        const info = await api.getPreviewInfo(docId);
        if (info.thumbs_progress && onProgress) {
          onProgress(info.thumbs_progress.current, info.thumbs_progress.total);
        }
      } catch { /* ignore */ }
    }, 500);
  };
  const startTimer = window.setTimeout(startPolling, 150);
  try {
    const data = await api.getPreviewThumbs(docId);
    previewPagesCache.set(docId, data.pages);
  } catch { /* ignore */ }
  finally {
    stopped = true;
    window.clearTimeout(startTimer);
    if (pollTimer !== null) window.clearInterval(pollTimer);
  }
}

function showSourceLoading(initialLabel: string): void {
  $('source-thumbs').style.display = 'none';
  $('source-thumbs').innerHTML = '';
  $('source-large').innerHTML = `<div class="text-text-muted text-center py-10">
    <div class="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
    <div class="mt-2" id="preview-progress-label">${initialLabel}</div>
  </div>`;
}

async function selectFirstDocOrClear(): Promise<void> {
  if (docsCache.length > 0) {
    const firstId = docsCache[0]!.id;
    await selectDocument(firstId);
  } else {
    selectedDocId = null;
    selectedPageIdx = 0;
    rerenderSource();
    renderResultTabs();
    await rerenderResult();
  }
}

async function selectDocument(docId: string): Promise<void> {
  if (selectedDocId !== docId) selectedPageIdx = 0;
  selectedDocId = docId;
  const doc = docsCache.find(d => d.id === docId) ?? null;
  if (doc) {
    if (doc.status === 'done') {
      // Default to markdown if available; otherwise the first available tab.
      const tabs = allResultTabs();
      if (isTabAvailable('markdown', doc.available_formats)) {
        resultTab = 'markdown';
      } else {
        const firstAvailable = tabs.find(tab => isTabAvailable(tab.key, doc.available_formats));
        if (firstAvailable) resultTab = firstAvailable.key;
      }
    }
    if (!previewPagesCache.has(docId)) {
      // UI does not "freeze" — show an instant spinner while thumbs load.
      showSourceLoading(t('preview.source.loading'));
    }
    await loadPagePreviews(docId, (cur, total) => {
      const label = document.getElementById('preview-progress-label');
      if (label) label.textContent = t('preview.source.rendering', { current: cur, total });
    });
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
    const prevSelected = selectedDocId !== null
      ? docsCache.find(d => d.id === selectedDocId)
      : null;
    docsCache = applySort(docs, state.sortMode.sort, state.sortMode.order);
    const newSelected = selectedDocId !== null
      ? docsCache.find(d => d.id === selectedDocId)
      : null;

    renderDocuments($('doc-list'), docsCache, selectedDocId);
    refreshStatusBar();
    refreshRecognizeButton();

    // If the selected document changed status (queued/processing → done/error)
    // or gained new available_formats — the Result pane shows a stale
    // "preview.unavailable". Force a tab switch and re-render,
    // otherwise the user sees "unavailable" until they click manually.
    if (selectedDocId !== null && newSelected) {
      const statusChanged = prevSelected?.status !== newSelected.status;
      const formatsChanged =
        (prevSelected?.available_formats?.length ?? 0) !== newSelected.available_formats.length;
      if (statusChanged || formatsChanged) {
        if (newSelected.status === 'done') {
          const tabs = allResultTabs();
          if (isTabAvailable('markdown', newSelected.available_formats)) {
            resultTab = 'markdown';
          } else {
            const firstAvailable = tabs.find(tab => isTabAvailable(tab.key, newSelected.available_formats));
            if (firstAvailable) resultTab = firstAvailable.key;
          }
        }
        renderResultTabs();
        await rerenderResult();
      }
    }

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
    // Auto-select the first uploaded document so PDF preview appears immediately,
    // without waiting for a click. This avoids the UX impression of "nothing happening".
    if (resp.ids.length > 0) {
      const firstId = resp.ids[0];
      if (firstId) await selectDocument(firstId);
    }
    // After upload — ensure polling is running (it may have been stopped by shouldStop earlier).
    // Otherwise a queued doc will "hang" in the UI without updates until the user clicks "Recognise".
    if (docsCache.some(d => d.status === 'queued' || d.status === 'processing')) {
      polling.start();
    }
  } catch (e) {
    toast.show((e as Error).message, 'error');
  }
}

function bindUI(): void {
  $('proj-list').addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>('.project-item');
    if (!item) return;
    const projId = Number(item.dataset.id);
    if (target.classList.contains('proj-menu')) { handleProjectMenu(projId); return; }
    if (projId === state.activeProjectId) return;
    state.setActiveProject(projId);
    await refreshProjects();
    await refreshDocuments();
    await selectFirstDocOrClear();
    polling.setProject(state.activeProjectId);
  });

  $('proj-list').addEventListener('dragover', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.project-item');
    if (item) {
      e.preventDefault();
      item.classList.add('drag-over');
    }
  });
  $('proj-list').addEventListener('dragleave', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.project-item');
    if (item) item.classList.remove('drag-over');
  });
  $('proj-list').addEventListener('drop', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.project-item');
    if (!item) return;
    item.classList.remove('drag-over');
    const projId = Number(item.dataset.id);
    handleDrop(e as DragEvent, projId, {
      onUpload: (files, pid) => { const ok = checkSize(files); if (ok.length) uploadFiles(ok, pid); },
      onMove: async (docId, pid) => { await api.moveDocument(docId, pid); await refreshProjects(); await refreshDocuments(); },
    });
  });

  $('proj-add-btn').addEventListener('click', async () => {
    const name = await modal.prompt(t('modal.project.create'));
    if (!name) return;
    try {
      const created = await api.createProject(name);
      state.setActiveProject(created.id);
      await refreshProjects();
      await refreshDocuments();
      await selectFirstDocOrClear();
      polling.setProject(state.activeProjectId);
    } catch (e) { toast.show((e as Error).message, 'error'); }
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
      onMove: async () => { /* dropzone does not accept document moves */ },
    });
  });

  $('recognize-btn').addEventListener('click', async () => {
    const pid = state.activeProjectId;
    try {
      const r = await api.recognizeProject(pid);
      // Unconditionally sync UI with backend (docsCache may be stale + polling may have died).
      await refreshDocuments();
      // Unconditionally start reactive polling — even if started=0, there may be processing documents.
      polling.start();
      if (r.started > 0) {
        toast.show(t('toast.recognize_started', { count: r.started }), 'info');
      }
    } catch (e) { toast.show((e as Error).message, 'error'); }
  });

  $('download-btn').addEventListener('click', () => {
    if (selectedDocId === null) return;
    const fmt = TAB_TO_FORMAT[resultTab];
    window.open(api.resultUrl(selectedDocId, fmt), '_blank');
  });

  $('download-docx-btn').addEventListener('click', () => {
    if (selectedDocId === null) return;
    window.open(api.resultUrl(selectedDocId, 'docx'), '_blank');
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
  // Defense-in-depth: protected projects (Inbox, Watch) have no .proj-menu rendered,
  // but guard here too in case someone crafts a DOM event manually.
  if (isProtectedProject(proj)) return;
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
          // The selected document may have belonged to the deleted project → cascade-deleted.
          // Clear panes, otherwise the preview "hangs".
          if (selectedDocId !== null) {
            previewPagesCache.delete(selectedDocId);
            selectedDocId = null;
            rerenderSource();
            renderResultTabs();
            await rerenderResult();
          }
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
        // Clear preview cache and panes — otherwise after deletion the preview "hangs" in Source/Result
        // until the user clicks another document.
        previewPagesCache.delete(docId);
        if (selectedDocId === docId) {
          selectedDocId = null;
          rerenderSource();
          renderResultTabs();
          await rerenderResult();
        }
        await refreshProjects();
        await refreshDocuments();
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) toast.show(t('toast.processing_required'), 'error');
        else toast.show((e as Error).message, 'error');
      }
    },
  }]);
}

/**
 * Re-read settings from the backend and refresh HQ indicator.
 * Called after the user applies settings changes (including after engine reload).
 */
async function refreshAfterReload(): Promise<void> {
  const s = await getSettings();
  state.setSettings(s);
  renderHqIndicator(isAnyHqActive(s));
}

/**
 * Poll state.reloadProgress every 200 ms and drive the reload overlay.
 * The SSE stream (settings_modal.ts) writes to state.setReloadProgress;
 * this watcher just reads and renders.
 *
 * Dedup guard: track the last rendered signature so DOM is only rebuilt when
 * the actual progress values change, preventing visible flicker at 5 fps.
 */
function watchReloadProgress(): void {
  let lastReloadSig = '';
  setInterval(() => {
    const p = state.getReloadProgress();
    const sig = p ? `${p.loaded ?? 'null'}|${p.total}|${p.current ?? 'null'}` : 'none';
    if (sig === lastReloadSig) return;
    lastReloadSig = sig;
    if (p) showReloadModal(p); else hideReloadModal();
  }, 200);
}

/**
 * Delegated click handler for settings / re-OCR actions rendered dynamically
 * into the DOM (gear icon, re-OCR doc button, re-OCR project button).
 */
function bindDynamicActions(): void {
  document.body.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    // Gear icon → open settings modal
    if (target.closest('[data-action="open-settings"]')) {
      const queueSize = docsCache.filter(
        (d) => d.status === 'queued' || d.status === 'processing',
      ).length;
      openSettingsModal({ mode: 'settings', queueSize, onApplied: refreshAfterReload });
      return;
    }

    // Re-OCR single document
    const reocrDocBtn = target.closest('[data-action="reocr-doc"]') as HTMLElement | null;
    if (reocrDocBtn) {
      if (!confirm(t('reocr.confirm_doc'))) return;
      try {
        await reocrDoc(reocrDocBtn.dataset.docId!);
        await refreshDocuments();
        polling.start();
      } catch (err) {
        toast.show((err as Error).message, 'error');
      }
      return;
    }

    // Re-OCR entire project
    if (target.closest('[data-action="reocr-project"]')) {
      const doneCount = docsCache.filter((d) => d.status === 'done').length;
      const msg = t('reocr.confirm_project').replace('{n}', String(doneCount));
      if (!confirm(msg)) return;
      try {
        await reocrProject(state.activeProjectId);
        await refreshDocuments();
        polling.start();
      } catch (err) {
        toast.show((err as Error).message, 'error');
      }
      return;
    }
  });
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
  bindDynamicActions();
  watchReloadProgress();

  pollSystemState();
  await refreshProjects();
  polling.setProject(state.activeProjectId);
  await refreshDocuments();
  polling.start();
  await refreshLimits();

  // Fetch settings and render HQ indicator; show onboarding modal on first run.
  try {
    const settingsResp = await getSettings();
    state.setSettings(settingsResp);
    renderHqIndicator(isAnyHqActive(settingsResp));
    if (!settingsResp.onboarding_seen) {
      openSettingsModal({ mode: 'onboarding', queueSize: 0, onApplied: refreshAfterReload });
    }
  } catch {
    // Settings endpoint unavailable — skip; onboarding will appear on next load.
  }
}

boot();
