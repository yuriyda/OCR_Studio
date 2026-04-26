import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('split.js', () => ({
  default: vi.fn((_elements: HTMLElement[], opts: any) => {
    return { setSizes: vi.fn(), getSizes: vi.fn(() => opts.sizes), destroy: vi.fn() };
  }),
}));

import { initSplitter } from '../../app/static/src/splitter';
import Split from 'split.js';

describe('splitter', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div><div id="c"></div>';
    (Split as any).mockClear();
  });

  it('initializes split.js with provided sizes', () => {
    initSplitter(
      [document.getElementById('a')!, document.getElementById('b')!, document.getElementById('c')!],
      [22, 38, 40],
      () => {},
    );
    expect(Split).toHaveBeenCalled();
    const args = (Split as any).mock.calls[0];
    expect(args[1].sizes).toEqual([22, 38, 40]);
    expect(args[1].direction).toBe('horizontal');
    expect(args[1].gutterSize).toBe(6);
  });

  it('calls onResize when onDragEnd fires', () => {
    const onResize = vi.fn();
    initSplitter(
      [document.getElementById('a')!, document.getElementById('b')!, document.getElementById('c')!],
      [22, 38, 40],
      onResize,
    );
    const opts = (Split as any).mock.calls.at(-1)[1];
    opts.onDragEnd([20, 40, 40]);
    expect(onResize).toHaveBeenCalledWith([20, 40, 40]);
  });

  it('uses minSize array', () => {
    initSplitter(
      [document.getElementById('a')!, document.getElementById('b')!, document.getElementById('c')!],
      [22, 38, 40],
      () => {},
    );
    const args = (Split as any).mock.calls[0];
    expect(args[1].minSize).toEqual([200, 250, 280]);
  });

  it('returns Split instance with control methods', () => {
    const inst = initSplitter(
      [document.getElementById('a')!, document.getElementById('b')!, document.getElementById('c')!],
      [22, 38, 40],
      () => {},
    );
    expect(inst).toBeDefined();
    expect(typeof inst.setSizes).toBe('function');
    expect(typeof inst.destroy).toBe('function');
  });
});
