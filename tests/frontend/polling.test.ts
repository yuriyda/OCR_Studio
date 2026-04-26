import { describe, it, expect, vi } from 'vitest';
import { Polling } from '../../app/static/src/polling';

describe('Polling', () => {
  it('starts and calls callback at base interval', async () => {
    vi.useFakeTimers();
    const cb = vi.fn().mockResolvedValue(undefined);
    const p = new Polling(cb, 2000);
    p.setProject(5);
    p.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(cb).toHaveBeenCalledWith(5);
    p.stop();
    vi.useRealTimers();
  });

  it('shouldStop returns true when no processing/queued', () => {
    const p = new Polling(async () => {}, 1000);
    expect(p.shouldStop([{ status: 'done' }, { status: 'done' }])).toBe(true);
    expect(p.shouldStop([{ status: 'processing' }])).toBe(false);
    expect(p.shouldStop([{ status: 'queued' }])).toBe(false);
    expect(p.shouldStop([])).toBe(true);
  });

  it('enableFast switches to 1s interval', async () => {
    vi.useFakeTimers();
    const cb = vi.fn().mockResolvedValue(undefined);
    const p = new Polling(cb, 2000);
    p.setProject(1);
    p.start();
    p.enableFast();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    p.stop();
    vi.useRealTimers();
  });

  it('disableFast reverts to base interval', async () => {
    vi.useFakeTimers();
    const cb = vi.fn().mockResolvedValue(undefined);
    const p = new Polling(cb, 2000);
    p.setProject(1);
    p.start();
    p.enableFast();
    p.disableFast();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    p.stop();
    vi.useRealTimers();
  });

  it('stop cancels timer', async () => {
    vi.useFakeTimers();
    const cb = vi.fn().mockResolvedValue(undefined);
    const p = new Polling(cb, 1000);
    p.setProject(1);
    p.start();
    p.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(cb).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('callback errors swallowed (no unhandled rejection)', async () => {
    vi.useFakeTimers();
    const cb = vi.fn().mockRejectedValue(new Error('boom'));
    const p = new Polling(cb, 1000);
    p.setProject(1);
    p.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalled();
    p.stop();
    vi.useRealTimers();
  });
});
