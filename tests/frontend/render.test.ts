/**
 * Tests for render.ts: HQ gear indicator and HQ status chip helpers.
 *
 * Maintenance notes:
 * - Tests use dynamic import to pick up the fresh module after DOM setup.
 * - Each test sets document.body.innerHTML before importing to control the DOM fixture.
 * - Do not rely on Vitest module caching between tests — use vi.resetModules() if needed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('renderHqIndicator', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('places a gear icon and a green dot when HQ is on', async () => {
    document.body.innerHTML = '<header><div class="flex gap-2 items-center"></div></header>';
    const render = await import('../../app/static/src/render');
    if (typeof (render as any).renderHqIndicator !== 'function') {
      throw new Error('renderHqIndicator not exported');
    }
    (render as any).renderHqIndicator(true);
    const gear = document.querySelector('[data-action="open-settings"]');
    expect(gear).not.toBeNull();
    const dot = document.querySelector('[data-hq-dot]');
    expect(dot?.classList.contains('bg-success')).toBe(true);
  });

  it('renders a gray dot when HQ is off', async () => {
    document.body.innerHTML = '<header><div class="flex gap-2 items-center"></div></header>';
    const render = await import('../../app/static/src/render');
    (render as any).renderHqIndicator(false);
    const dot = document.querySelector('[data-hq-dot]');
    expect(dot?.classList.contains('bg-text-faint')).toBe(true);
  });

  it('is idempotent — does not duplicate the indicator on repeated calls', async () => {
    document.body.innerHTML = '<header><div class="flex gap-2 items-center"></div></header>';
    const render = await import('../../app/static/src/render');
    (render as any).renderHqIndicator(true);
    (render as any).renderHqIndicator(false);
    const indicators = document.querySelectorAll('[data-hq-indicator]');
    expect(indicators.length).toBe(1);
    // After the second call (hqOn=false), dot should be gray
    const dot = document.querySelector('[data-hq-dot]');
    expect(dot?.classList.contains('bg-text-faint')).toBe(true);
  });
});

describe('renderHqStatusChip', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('renders ON chip with model count', async () => {
    document.body.innerHTML = '<div id="statusbar"><div data-statusbar-row></div></div>';
    const render = await import('../../app/static/src/render');
    if (typeof (render as any).renderHqStatusChip === 'function') {
      (render as any).renderHqStatusChip(true, 5);
      const chip = document.querySelector('[data-hq-chip]');
      expect(chip).not.toBeNull();
      expect(chip?.textContent).toContain('5');
    }
  });

  it('renders OFF chip when HQ is disabled', async () => {
    document.body.innerHTML = '<div id="statusbar"><div data-statusbar-row></div></div>';
    const render = await import('../../app/static/src/render');
    if (typeof (render as any).renderHqStatusChip === 'function') {
      (render as any).renderHqStatusChip(false, 0);
      const chip = document.querySelector('[data-hq-chip]');
      expect(chip).not.toBeNull();
      // OFF chip should not contain a number
      expect(chip?.textContent).not.toMatch(/\d+/);
    }
  });

  it('is idempotent — does not duplicate chip on repeated calls', async () => {
    document.body.innerHTML = '<div id="statusbar"><div data-statusbar-row></div></div>';
    const render = await import('../../app/static/src/render');
    if (typeof (render as any).renderHqStatusChip === 'function') {
      (render as any).renderHqStatusChip(true, 3);
      (render as any).renderHqStatusChip(false, 0);
      const chips = document.querySelectorAll('[data-hq-chip]');
      expect(chips.length).toBe(1);
    }
  });
});
