import { describe, it, expect, beforeEach } from 'vitest';
import { renderStatusBar } from '../../app/static/js/statusbar.js';

describe('statusbar', () => {
  let container;
  beforeEach(() => {
    document.body.innerHTML = '<div id="sb"></div>';
    container = document.getElementById('sb');
  });

  it('renders three sections', () => {
    renderStatusBar(container, {
      env: { gpu: 'RTX 4090', cuda: '12.6', vram_gb: 16 },
      engine: { name: 'PPStructureV3', lang: 'ru', status: 'ready' },
      project: { name: 'Inbox', doc_count: 3, total_bytes: 1024 * 1024 * 12, processing: 1, queued: 0 },
    });
    expect(container.querySelectorAll('.sb-section').length).toBe(3);
  });

  it('shows "недоступно" when env null', () => {
    renderStatusBar(container, {
      env: { gpu: null, cuda: null, vram_gb: null },
      engine: { name: 'PPStructureV3', lang: 'ru', status: 'ready' },
      project: { name: 'Inbox', doc_count: 0, total_bytes: 0, processing: 0, queued: 0 },
    });
    expect(container.textContent).toMatch(/недоступно/i);
  });

  it('formats total_bytes as MB', () => {
    renderStatusBar(container, {
      env: { gpu: 'X', cuda: '1', vram_gb: 1 },
      engine: { name: 'E', lang: 'ru', status: 'ready' },
      project: { name: 'P', doc_count: 1, total_bytes: 12 * 1024 * 1024, processing: 0, queued: 0 },
    });
    expect(container.textContent).toContain('12');
    expect(container.textContent.toLowerCase()).toContain('мб');
  });
});
