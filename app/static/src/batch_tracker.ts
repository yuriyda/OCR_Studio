/**
 * Pure state machine for client-side OCR queue batch tracking.
 *
 * Maintenance notes:
 * - No DOM, no globals, no time-of-day side effects — all inputs are explicit.
 * - "Batch" boundaries are derived purely from observed queue activity:
 *   * batch starts when (queued + processing) transitions from 0 to >0
 *   * batch ends when (queued + processing) returns to 0
 * - Total grows monotonically within a batch (max of seen totals). This way the
 *   progress bar percent can dip slightly when new files arrive mid-batch, but
 *   the M/N counter stays truthful.
 * - The completed counter on the server is monotonic across the whole uvicorn
 *   session. We use the server value at batch start as a baseline; if it ever
 *   decreases (uvicorn restart) we restart the batch.
 * - Transient off-by-one: worker increments completed_since_start AFTER updating
 *   doc status, so one poll may see active drop by 1 before counter catches up.
 *   The max(prev.totalInBatch, completed + active) guard ensures totalInBatch never
 *   shrinks — self-corrects on the next poll cycle.
 */

export interface QueueSample {
  queued: number;
  processing: number;
  completed_since_start: number;
}

export interface BatchSummary {
  total: number;
  elapsedMs: number;
}

export interface BatchState {
  active: boolean;
  startTime: number | null;
  baselineCompleted: number | null;
  totalInBatch: number;
  completedInBatch: number;
  activeNow: number;
  lastSummary: BatchSummary | null;
}

export function initialBatchState(): BatchState {
  return {
    active: false,
    startTime: null,
    baselineCompleted: null,
    totalInBatch: 0,
    completedInBatch: 0,
    activeNow: 0,
    lastSummary: null,
  };
}

/**
 * Pure transition function: given previous state, a new server sample, and the
 * current wall-clock time (ms), returns the next state. Never mutates prev.
 */
export function updateBatch(prev: BatchState, sample: QueueSample, now: number): BatchState {
  const active = sample.queued + sample.processing;

  // Detect server restart: completed counter went backwards.
  const restarted = prev.active
    && prev.baselineCompleted !== null
    && sample.completed_since_start < prev.baselineCompleted;

  if (restarted) {
    return {
      active: active > 0,
      startTime: active > 0 ? now : null,
      baselineCompleted: active > 0 ? sample.completed_since_start : null,
      totalInBatch: active,
      completedInBatch: 0,
      activeNow: active,
      lastSummary: prev.lastSummary,
    };
  }

  // Transition: idle → active (new batch starts).
  if (!prev.active && active > 0) {
    return {
      active: true,
      startTime: now,
      baselineCompleted: sample.completed_since_start,
      totalInBatch: active,
      completedInBatch: 0,
      activeNow: active,
      lastSummary: prev.lastSummary,
    };
  }

  // Transition: active → idle (batch finishes).
  if (prev.active && active === 0) {
    const elapsedMs = prev.startTime !== null ? now - prev.startTime : 0;
    return {
      active: false,
      startTime: null,
      baselineCompleted: null,
      totalInBatch: 0,
      completedInBatch: 0,
      activeNow: 0,
      lastSummary: { total: prev.totalInBatch, elapsedMs },
    };
  }

  // Steady state: active → active (batch in progress).
  if (prev.active) {
    const baseline = prev.baselineCompleted ?? 0;
    const completed = Math.max(0, sample.completed_since_start - baseline);
    // totalInBatch grows monotonically: handles both new-files arrival and the
    // transient off-by-one where active drops before counter increments.
    const total = Math.max(prev.totalInBatch, completed + active);
    return {
      active: true,
      startTime: prev.startTime,
      baselineCompleted: prev.baselineCompleted,
      totalInBatch: total,
      completedInBatch: completed,
      activeNow: active,
      lastSummary: prev.lastSummary,
    };
  }

  // Idle stays idle — preserve lastSummary.
  return { ...prev };
}
