/**
 * Polling: периодически дёргает callback для обновления списка документов.
 *
 * Редактирование:
 * - Base interval (2 сек) — для обычного состояния "ничего не обрабатывается".
 * - Fast mode (1 сек) — включается через enableFast() когда есть processing документ
 *   (live progress UI должен обновляться достаточно часто, чтобы быть полезным).
 * - shouldStop — controller использует чтобы остановить poll, когда вся очередь пуста.
 * - Callback errors swallowed внутри tick'а — иначе bad fetch ломает таймер.
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
