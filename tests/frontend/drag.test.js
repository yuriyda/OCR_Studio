import { describe, it, expect, vi } from 'vitest';
import { handleDrop } from '../../app/static/js/drag.js';

describe('drag.handleDrop', () => {
  it('upload when types contains Files', () => {
    const onUpload = vi.fn();
    const onMove = vi.fn();
    const ev = {
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ['Files'],
        files: [{ name: 'a.pdf' }],
        getData: () => '',
      },
    };
    handleDrop(ev, 5, { onUpload, onMove });
    expect(onUpload).toHaveBeenCalledWith([{ name: 'a.pdf' }], 5);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('move when types contains application/x-ocr-doc', () => {
    const onUpload = vi.fn();
    const onMove = vi.fn();
    const ev = {
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ['application/x-ocr-doc'],
        files: [],
        getData: (k) => (k === 'application/x-ocr-doc' ? 'doc123' : ''),
      },
    };
    handleDrop(ev, 5, { onUpload, onMove });
    expect(onMove).toHaveBeenCalledWith('doc123', 5);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('does nothing for unrecognized drop', () => {
    const onUpload = vi.fn();
    const onMove = vi.fn();
    const ev = {
      preventDefault: vi.fn(),
      dataTransfer: { types: ['text/plain'], files: [], getData: () => '' },
    };
    handleDrop(ev, 5, { onUpload, onMove });
    expect(onUpload).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });
});
