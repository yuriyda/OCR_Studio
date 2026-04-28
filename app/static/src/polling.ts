/**
 * Polling: periodically fires a callback to refresh the document list.
 *
 * Maintenance notes:
 * - Base interval (2 s) — for the idle state "nothing is being processed".
 * - Fast mode (1 s) — enabled via enableFast() when there is a processing document
 *   (live progress UI must update frequently enough to be useful).
 * - shouldStop — used by the controller to stop polling when the entire queue is empty.
 * - Callback errors are swallowed inside the tick — otherwise a bad fetch breaks the timer.
 */

type PollCallback = (projectId: number) => Promise<void>;

interface DocLite { status: string }

const FAST_INTERVAL = 1000;

export class Polling {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private projectId: number = 1;
  private fastMode = false;

  constructor(private cb: PollCallback, private baseInterval: number = 2000) {}

  setProject(id: number): void { this.projectId = id; }

  start(): void {
    this.stop();
    const tick = (): void => { this.cb(this.projectId).catch(() => {}); };
    this.intervalId = setInterval(tick, this.fastMode ? FAST_INTERVAL : this.baseInterval);
  }

  stop(): void {
    if (this.intervalId !== null) { clearInterval(this.intervalId); this.intervalId = null; }
  }

  enableFast(): void {
    if (this.fastMode) return;
    this.fastMode = true;
    if (this.intervalId !== null) this.start();
  }

  disableFast(): void {
    if (!this.fastMode) return;
    this.fastMode = false;
    if (this.intervalId !== null) this.start();
  }

  shouldStop(docs: DocLite[]): boolean {
    return !docs.some(d => d.status === 'processing' || d.status === 'queued');
  }
}
