import { describe, it, expect, vi, beforeAll } from 'vitest';
import { handleDrop, startDocDrag } from '../../app/static/src/drag';

// jsdom does not implement DataTransfer/DragEvent — minimal polyfill for our use-case.
beforeAll(() => {
  if (typeof (globalThis as any).DataTransfer === 'undefined') {
    class FileListPolyfill extends Array<File> {}
    class DataTransferPolyfill {
      private store = new Map<string, string>();
      effectAllowed: string = 'none';
      files: FileListPolyfill = new FileListPolyfill();
      items = {
        add: (f: File) => {
          this.files.push(f);
        },
      };
      setData(type: string, value: string): void {
        this.store.set(type, value);
      }
      getData(type: string): string {
        return this.store.get(type) ?? '';
      }
    }
    (globalThis as any).DataTransfer = DataTransferPolyfill;
  }
  if (typeof (globalThis as any).DragEvent === 'undefined') {
    class DragEventPolyfill extends Event {
      dataTransfer: DataTransfer | null;
      constructor(type: string, init?: { dataTransfer?: DataTransfer | null }) {
        super(type);
        this.dataTransfer = init?.dataTransfer ?? null;
      }
    }
    (globalThis as any).DragEvent = DragEventPolyfill;
  }
});

describe('handleDrop', () => {
  it('with files calls onUpload (drop = queue, not start)', () => {
    const file = new File(['x'], 't.pdf');
    const dt = new DataTransfer();
    dt.items.add(file);
    const e = new DragEvent('drop', { dataTransfer: dt });
    Object.defineProperty(e, 'preventDefault', { value: vi.fn() });

    const onUpload = vi.fn();
    const onMove = vi.fn();
    handleDrop(e, 5, { onUpload, onMove });
    expect(onUpload).toHaveBeenCalledWith([file], 5);
    expect(onMove).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('with x-ocr-doc data calls onMove with string id', () => {
    const dt = new DataTransfer();
    dt.setData('application/x-ocr-doc', 'a1b2c3d4');
    const e = new DragEvent('drop', { dataTransfer: dt });
    Object.defineProperty(e, 'preventDefault', { value: vi.fn() });

    const onUpload = vi.fn();
    const onMove = vi.fn();
    handleDrop(e, 7, { onUpload, onMove });
    expect(onMove).toHaveBeenCalledWith('a1b2c3d4', 7);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('handles empty drop (no files, no data)', () => {
    const dt = new DataTransfer();
    const e = new DragEvent('drop', { dataTransfer: dt });
    Object.defineProperty(e, 'preventDefault', { value: vi.fn() });

    const onUpload = vi.fn();
    const onMove = vi.fn();
    handleDrop(e, 1, { onUpload, onMove });
    expect(onUpload).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('startDocDrag', () => {
  it('sets dataTransfer with string id (already string)', () => {
    const dt = new DataTransfer();
    const e = new DragEvent('dragstart', { dataTransfer: dt });
    startDocDrag(e, 'a1b2c3');
    expect(dt.getData('application/x-ocr-doc')).toBe('a1b2c3');
    expect(dt.effectAllowed).toBe('move');
  });

  it('coerces number id to string', () => {
    const dt = new DataTransfer();
    const e = new DragEvent('dragstart', { dataTransfer: dt });
    startDocDrag(e, 88);
    expect(dt.getData('application/x-ocr-doc')).toBe('88');
  });

  it('handles missing dataTransfer gracefully', () => {
    const e = { dataTransfer: null } as unknown as DragEvent;
    expect(() => startDocDrag(e, 'x')).not.toThrow();
  });
});
