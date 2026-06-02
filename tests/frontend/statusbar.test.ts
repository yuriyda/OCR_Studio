import { describe, it, expect, beforeEach } from 'vitest';
import { renderStatusBar } from '../../app/static/src/statusbar';
import { loadLang } from '../../app/static/src/i18n';

describe('renderStatusBar', () => {
  beforeEach(() => { loadLang('ru'); document.body.innerHTML = '<div id="sb"></div>'; });

  function idleQueue() {
    return {
      active: false, completedInBatch: 0, totalInBatch: 0, activeNow: 0,
      elapsedMs: 0, etaMs: null, lastSummary: null, current: null,
    };
  }

  it('renders engine ready + env + project sections', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'RTX 4090', cuda: '13.1', vram_gb: 16 },
      engine: { name: 'PPStructureV3', lang: 'ru', status: 'ready', pipeline: [] },
      project: { name: 'Inbox', doc_count: 5, total_bytes: 12 * 1024 * 1024, processing: 0, queued: 2 },
      queue: idleQueue(),
    });
    expect(sb.textContent).toContain('RTX 4090');
    expect(sb.textContent).toContain('CUDA 13.1');
    expect(sb.textContent).toContain('5');
    expect(sb.textContent).toContain('12.0 МБ');
    expect(sb.textContent).toContain('готов');
    // engine.lang ("· ru") is intentionally hidden — it is the OCR engine, not the UI locale.
    // Verify it does NOT appear as a separate token after the status.
    expect(sb.textContent).not.toMatch(/готов\s*·\s*ru/);
  });

  it('shows engine loading state', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: null, cuda: null, vram_gb: null },
      engine: { name: 'PPStructureV3', lang: 'en', status: 'loading', pipeline: [] },
      project: null,
      queue: idleQueue(),
    });
    expect(sb.textContent).toContain('загрузка');
  });

  it('does not render engine.lang anywhere (hidden by design)', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: null, cuda: null, vram_gb: null },
      engine: { name: 'PPStructureV3', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
      queue: idleQueue(),
    });
    // engine.lang — this is the OCR engine language (cyrillic). It is not rendered in the status bar,
    // only in the tooltip (via the pipeline model list).
    expect(sb.textContent).not.toContain('· ru');
  });

  it('hides project section when null', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'X', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
      queue: idleQueue(),
    });
    expect(sb.textContent).not.toContain('док');
  });

  it('localized to en', () => {
    loadLang('en');
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'GPU', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'en', status: 'ready', pipeline: [] },
      project: { name: 'P', doc_count: 3, total_bytes: 1024, processing: 0, queued: 0 },
      queue: idleQueue(),
    });
    expect(sb.textContent).toContain('ready');
    expect(sb.textContent).toContain('docs');
  });

  it('engine element has title tooltip with pipeline model list', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: null, cuda: null, vram_gb: null },
      engine: {
        name: 'PPStructureV3', lang: 'ru', status: 'ready',
        pipeline: [
          { role: 'layout', name: 'PicoDet-S_layout_3cls' },
          { role: 'text_rec', name: 'cyrillic_PP-OCRv3' },
        ],
      },
      project: null,
      queue: idleQueue(),
    });
    const engineSpan = sb.querySelector('[data-engine]') as HTMLElement | null;
    expect(engineSpan).toBeTruthy();
    expect(engineSpan!.title).toContain('layout: PicoDet-S_layout_3cls');
    expect(engineSpan!.title).toContain('text_rec: cyrillic_PP-OCRv3');
  });

  it('does not render queue row when idle without lastSummary', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'X', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
      queue: idleQueue(),
    });
    expect(sb.querySelector('[data-queue-row]')).toBeNull();
    expect(sb.querySelector('[data-queue-last-summary]')).toBeNull();
  });

  it('appends last batch tail when idle with lastSummary', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'X', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
      queue: { ...idleQueue(), lastSummary: { total: 12, elapsedMs: 252000 } },
    });
    expect(sb.querySelector('[data-queue-row]')).toBeNull();
    const tail = sb.querySelector('[data-queue-last-summary]') as HTMLElement | null;
    expect(tail).not.toBeNull();
    expect(tail!.textContent).toContain('12');
    expect(tail!.textContent).toContain('4:12');
  });

  it('renders queue row with progress bar, counters, elapsed and eta when active', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'X', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
      queue: {
        active: true, completedInBatch: 12, totalInBatch: 20, activeNow: 8,
        elapsedMs: 204000, etaMs: 338000, lastSummary: null, current: null,
      },
    });
    const queueRow = sb.querySelector('[data-queue-row]') as HTMLElement;
    expect(queueRow).not.toBeNull();
    expect(queueRow.textContent).toContain('12');
    expect(queueRow.textContent).toContain('20');
    expect(queueRow.textContent).toContain('8');
    expect(queueRow.textContent).toContain('3:24');
    expect(queueRow.textContent).toContain('5:38');
    const fill = sb.querySelector('[data-queue-fill]') as HTMLElement;
    expect(fill.style.width).toBe('60%');
  });

  it('hides eta when no completed yet', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'X', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
      queue: {
        active: true, completedInBatch: 0, totalInBatch: 5, activeNow: 5,
        elapsedMs: 1000, etaMs: null, lastSummary: null, current: null,
      },
    });
    const queueRow = sb.querySelector('[data-queue-row]') as HTMLElement;
    expect(queueRow.textContent).toContain('0');
    expect(queueRow.textContent).toContain('5');
    expect(queueRow.textContent).not.toContain('~ETA');
  });

  it('queue fill width clamps to 100% if completed exceeds total (defensive)', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'X', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
      queue: {
        active: true, completedInBatch: 7, totalInBatch: 5, activeNow: 0,
        elapsedMs: 5000, etaMs: null, lastSummary: null, current: null,
      },
    });
    const fill = sb.querySelector('[data-queue-fill]') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('formats hour-long elapsed as H:MM:SS', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'X', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
      queue: {
        active: true, completedInBatch: 1, totalInBatch: 10, activeNow: 9,
        elapsedMs: 3725000, etaMs: 36000, lastSummary: null, current: null,
      },
    });
    const queueRow = sb.querySelector('[data-queue-row]') as HTMLElement;
    expect(queueRow.textContent).toContain('1:02:05');
  });

  it('renders current filename and size at end of queue row when active', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'X', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
      queue: {
        active: true, completedInBatch: 1, totalInBatch: 3, activeNow: 2,
        elapsedMs: 5000, etaMs: 10000, lastSummary: null,
        current: { filename: 'doc.pdf', size_bytes: 2_400_000 },
      },
    });
    const queueRow = sb.querySelector('[data-queue-row]') as HTMLElement;
    expect(queueRow.textContent).toContain('doc.pdf');
    expect(queueRow.textContent).toContain('2.3 МБ');
  });

  it('omits current filename when queue.current is null', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'X', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
      queue: {
        active: true, completedInBatch: 0, totalInBatch: 3, activeNow: 3,
        elapsedMs: 1000, etaMs: null, lastSummary: null,
        current: null,
      },
    });
    const queueRow = sb.querySelector('[data-queue-row]') as HTMLElement;
    expect(queueRow.textContent).not.toContain('.pdf');
  });

  it('truncates long filename with mid-ellipsis', () => {
    const sb = document.getElementById('sb')!;
    const longName = 'Очень-длинное-имя-сканированного-документа-2026-06-02.pdf';
    renderStatusBar(sb, {
      env: { gpu: 'X', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
      queue: {
        active: true, completedInBatch: 1, totalInBatch: 3, activeNow: 2,
        elapsedMs: 5000, etaMs: 10000, lastSummary: null,
        current: { filename: longName, size_bytes: 1000 },
      },
    });
    const queueRow = sb.querySelector('[data-queue-row]') as HTMLElement;
    // Original name length is > 40; rendered name should NOT contain the full string.
    expect(queueRow.textContent).not.toContain(longName);
    // Mid-ellipsis preserves prefix and extension.
    expect(queueRow.textContent).toContain('Очень');
    expect(queueRow.textContent).toContain('.pdf');
    expect(queueRow.textContent).toContain('…');
  });

  it('does not truncate short filenames', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'X', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
      queue: {
        active: true, completedInBatch: 1, totalInBatch: 3, activeNow: 2,
        elapsedMs: 5000, etaMs: 10000, lastSummary: null,
        current: { filename: 'short.pdf', size_bytes: 1000 },
      },
    });
    const queueRow = sb.querySelector('[data-queue-row]') as HTMLElement;
    expect(queueRow.textContent).toContain('short.pdf');
    expect(queueRow.textContent).not.toContain('…');
  });
});
