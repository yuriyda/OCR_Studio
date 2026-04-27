import { describe, it, expect, beforeEach } from 'vitest';
import { renderStatusBar } from '../../app/static/src/statusbar';
import { loadLang } from '../../app/static/src/i18n';

describe('renderStatusBar', () => {
  beforeEach(() => { loadLang('ru'); document.body.innerHTML = '<div id="sb"></div>'; });

  it('renders engine ready + env + project sections', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'RTX 4090', cuda: '13.1', vram_gb: 16 },
      engine: { name: 'PPStructureV3', lang: 'ru', status: 'ready', pipeline: [] },
      project: { name: 'Inbox', doc_count: 5, total_bytes: 12 * 1024 * 1024, processing: 0, queued: 2 },
    });
    expect(sb.textContent).toContain('RTX 4090');
    expect(sb.textContent).toContain('CUDA 13.1');
    expect(sb.textContent).toContain('5');
    expect(sb.textContent).toContain('12.0 МБ');
    expect(sb.textContent).toContain('готов');
    expect(sb.textContent).toContain('ru');
  });

  it('shows engine loading state', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: null, cuda: null, vram_gb: null },
      engine: { name: 'PPStructureV3', lang: 'en', status: 'loading', pipeline: [] },
      project: null,
    });
    expect(sb.textContent).toContain('загрузка');
  });

  it('renders engine lang dash when null', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: null, cuda: null, vram_gb: null },
      engine: { name: 'PPStructureV3', lang: null, status: 'idle', pipeline: [] },
      project: null,
    });
    expect(sb.textContent).toContain('—');
  });

  it('hides project section when null', () => {
    const sb = document.getElementById('sb')!;
    renderStatusBar(sb, {
      env: { gpu: 'X', cuda: '1', vram_gb: 8 },
      engine: { name: 'X', lang: 'ru', status: 'ready', pipeline: [] },
      project: null,
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
    });
    const engineSpan = sb.querySelector('[data-engine]') as HTMLElement | null;
    expect(engineSpan).toBeTruthy();
    expect(engineSpan!.title).toContain('layout: PicoDet-S_layout_3cls');
    expect(engineSpan!.title).toContain('text_rec: cyrillic_PP-OCRv3');
  });
});
