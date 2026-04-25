// Polling статуса документов активного проекта.
// Редактирование: интервал — только через конструктор; стартует/останавливается извне.

export class Polling {
  constructor(callback, intervalMs = 2000) {
    this.callback = callback;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.projectId = null;
  }

  setProject(id) {
    this.projectId = id;
  }

  async tickOnce() {
    return this.callback(this.projectId);
  }

  shouldStop(docs) {
    return !docs.some(d => d.status === 'queued' || d.status === 'processing');
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tickOnce(), this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
