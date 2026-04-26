import { describe, it, expect, vi } from 'vitest';
import { filterBySize, formatTooLargeMessage } from '../../app/static/src/validation';

const makeFile = (name: string, size: number): File => {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('filterBySize', () => {
  it('keeps files smaller than max', () => {
    const small = makeFile('s.txt', 100);
    const ok = filterBySize([small], 500, () => {});
    expect(ok).toEqual([small]);
  });
  it('filters out large files and calls callback', () => {
    const small = makeFile('s.txt', 100);
    const big = makeFile('b.txt', 1000);
    const onTooLarge = vi.fn();
    const ok = filterBySize([small, big], 500, onTooLarge);
    expect(ok).toEqual([small]);
    expect(onTooLarge).toHaveBeenCalledWith([big], 500);
  });
  it('does not call callback when none rejected', () => {
    const cb = vi.fn();
    filterBySize([makeFile('a', 10)], 100, cb);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('formatTooLargeMessage', () => {
  it('formats with file names and MB limit', () => {
    const f = makeFile('huge.pdf', 60 * 1024 * 1024);
    const msg = formatTooLargeMessage([f], 50 * 1024 * 1024);
    expect(msg).toContain('huge.pdf');
    expect(msg).toContain('50');
  });
});
