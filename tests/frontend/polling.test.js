import { describe, it, expect, vi } from 'vitest';
import { Polling } from '../../app/static/js/polling.js';

describe('Polling', () => {
  it('calls callback with project_id', async () => {
    const cb = vi.fn().mockResolvedValue([]);
    const p = new Polling(cb, 100);
    p.setProject(5);
    await p.tickOnce();
    expect(cb).toHaveBeenCalledWith(5);
  });

  it('stops when no queued/processing in last response', async () => {
    const cb = vi.fn().mockResolvedValue([{ status: 'done' }]);
    const p = new Polling(cb, 100);
    p.setProject(1);
    await p.tickOnce();
    expect(p.shouldStop([{ status: 'done' }])).toBe(true);
  });

  it('does not stop when queued present', async () => {
    const p = new Polling(() => Promise.resolve([]), 100);
    expect(p.shouldStop([{ status: 'queued' }])).toBe(false);
  });
});
