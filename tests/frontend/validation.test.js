import { describe, it, expect, vi } from 'vitest';
import { filterBySize, formatTooLargeMessage } from '../../app/static/js/validation.js';

describe('validation.filterBySize', () => {
  it('returns all files when all under limit', () => {
    const files = [{ name: 'a.pdf', size: 1000 }, { name: 'b.pdf', size: 2000 }];
    expect(filterBySize(files, 5000)).toEqual(files);
  });

  it('drops files larger than limit', () => {
    const files = [{ name: 'small.pdf', size: 1000 }, { name: 'big.pdf', size: 9999 }];
    expect(filterBySize(files, 5000)).toEqual([{ name: 'small.pdf', size: 1000 }]);
  });

  it('files exactly at limit pass', () => {
    const files = [{ name: 'edge.pdf', size: 5000 }];
    expect(filterBySize(files, 5000)).toEqual(files);
  });

  it('calls onTooLarge with rejected files and limit', () => {
    const files = [{ name: 'small.pdf', size: 100 }, { name: 'big.pdf', size: 9999 }];
    const cb = vi.fn();
    filterBySize(files, 1000, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toEqual([{ name: 'big.pdf', size: 9999 }]);
    expect(cb.mock.calls[0][1]).toBe(1000);
  });

  it('does not call onTooLarge when nothing rejected', () => {
    const cb = vi.fn();
    filterBySize([{ name: 'a', size: 100 }], 1000, cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('uses 50MB default when maxBytes is 0/null', () => {
    const fileBig = { name: 'big', size: 51 * 1024 * 1024 };
    const fileSmall = { name: 'small', size: 49 * 1024 * 1024 };
    expect(filterBySize([fileBig, fileSmall], null)).toEqual([fileSmall]);
    expect(filterBySize([fileBig, fileSmall], 0)).toEqual([fileSmall]);
  });
});

describe('validation.formatTooLargeMessage', () => {
  it('lists filenames with sizes in MB', () => {
    const msg = formatTooLargeMessage(
      [{ name: 'a.pdf', size: 60 * 1024 * 1024 }],
      50 * 1024 * 1024
    );
    expect(msg).toContain('a.pdf');
    expect(msg).toContain('60.0 MB');
    expect(msg).toContain('макс 50');
  });

  it('joins multiple filenames with comma', () => {
    const msg = formatTooLargeMessage(
      [{ name: 'a.pdf', size: 100 * 1024 * 1024 }, { name: 'b.pdf', size: 200 * 1024 * 1024 }],
      50 * 1024 * 1024
    );
    expect(msg).toContain('a.pdf');
    expect(msg).toContain('b.pdf');
    expect(msg).toContain(',');
  });
});
