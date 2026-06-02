import { describe, it, expect } from 'vitest';
import { initialBatchState, updateBatch, type BatchState, type QueueSample } from '../../app/static/src/batch_tracker';

describe('batch_tracker', () => {
  it('initialBatchState returns idle with no summary', () => {
    const s = initialBatchState();
    expect(s.active).toBe(false);
    expect(s.startTime).toBeNull();
    expect(s.totalInBatch).toBe(0);
    expect(s.completedInBatch).toBe(0);
    expect(s.lastSummary).toBeNull();
  });

  it('idle → active: starts batch, captures baseline and startTime', () => {
    const prev = initialBatchState();
    const sample: QueueSample = { queued: 2, processing: 1, completed_since_start: 10 };
    const next = updateBatch(prev, sample, 1000);
    expect(next.active).toBe(true);
    expect(next.startTime).toBe(1000);
    expect(next.baselineCompleted).toBe(10);
    expect(next.totalInBatch).toBe(3);
    expect(next.completedInBatch).toBe(0);
    expect(next.activeNow).toBe(3);
  });

  it('active → active with progress: completed grows, total stays', () => {
    const prev: BatchState = {
      active: true, startTime: 1000, baselineCompleted: 10,
      totalInBatch: 3, completedInBatch: 0, activeNow: 3, lastSummary: null,
    };
    const sample: QueueSample = { queued: 0, processing: 2, completed_since_start: 11 };
    const next = updateBatch(prev, sample, 2000);
    expect(next.active).toBe(true);
    expect(next.startTime).toBe(1000);
    expect(next.completedInBatch).toBe(1);
    expect(next.totalInBatch).toBe(3);
    expect(next.activeNow).toBe(2);
  });

  it('active → new files arrive: total grows monotonically', () => {
    const prev: BatchState = {
      active: true, startTime: 1000, baselineCompleted: 10,
      totalInBatch: 3, completedInBatch: 0, activeNow: 3, lastSummary: null,
    };
    const sample: QueueSample = { queued: 3, processing: 2, completed_since_start: 11 };
    const next = updateBatch(prev, sample, 2000);
    expect(next.totalInBatch).toBe(6);
    expect(next.completedInBatch).toBe(1);
    expect(next.startTime).toBe(1000);
  });

  it('active → idle: closes batch and captures lastSummary', () => {
    const prev: BatchState = {
      active: true, startTime: 1000, baselineCompleted: 10,
      totalInBatch: 5, completedInBatch: 3, activeNow: 2, lastSummary: null,
    };
    const sample: QueueSample = { queued: 0, processing: 0, completed_since_start: 15 };
    const next = updateBatch(prev, sample, 5000);
    expect(next.active).toBe(false);
    expect(next.startTime).toBeNull();
    expect(next.totalInBatch).toBe(0);
    expect(next.completedInBatch).toBe(0);
    expect(next.lastSummary).toEqual({ total: 5, elapsedMs: 4000 });
  });

  it('idle stays idle: preserves lastSummary', () => {
    const prev: BatchState = {
      active: false, startTime: null, baselineCompleted: null,
      totalInBatch: 0, completedInBatch: 0, activeNow: 0,
      lastSummary: { total: 5, elapsedMs: 4000 },
    };
    const sample: QueueSample = { queued: 0, processing: 0, completed_since_start: 15 };
    const next = updateBatch(prev, sample, 6000);
    expect(next.active).toBe(false);
    expect(next.lastSummary).toEqual({ total: 5, elapsedMs: 4000 });
  });

  it('counter decrease (server restart) treated as new batch start', () => {
    const prev: BatchState = {
      active: true, startTime: 1000, baselineCompleted: 100,
      totalInBatch: 5, completedInBatch: 3, activeNow: 2, lastSummary: null,
    };
    const sample: QueueSample = { queued: 1, processing: 0, completed_since_start: 0 };
    const next = updateBatch(prev, sample, 2000);
    expect(next.active).toBe(true);
    expect(next.startTime).toBe(2000);
    expect(next.baselineCompleted).toBe(0);
    expect(next.totalInBatch).toBe(1);
    expect(next.completedInBatch).toBe(0);
  });

  it('multi-poll scenario: idle → active → grow → drain → idle', () => {
    let s = initialBatchState();
    s = updateBatch(s, { queued: 2, processing: 0, completed_since_start: 0 }, 1000);
    expect(s.active).toBe(true);
    expect(s.totalInBatch).toBe(2);

    s = updateBatch(s, { queued: 4, processing: 1, completed_since_start: 0 }, 2000);
    expect(s.totalInBatch).toBe(5);

    s = updateBatch(s, { queued: 1, processing: 1, completed_since_start: 3 }, 5000);
    expect(s.completedInBatch).toBe(3);
    expect(s.totalInBatch).toBe(5);

    s = updateBatch(s, { queued: 0, processing: 0, completed_since_start: 5 }, 7000);
    expect(s.active).toBe(false);
    expect(s.lastSummary).toEqual({ total: 5, elapsedMs: 6000 });
  });
});
