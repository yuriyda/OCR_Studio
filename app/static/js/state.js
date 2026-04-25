// Локальное состояние UI: активный проект, sort mode.
// Редактирование: ключи localStorage не переименовывать без миграции.

const KEYS = { activeProject: 'ocr.activeProjectId', sortMode: 'ocr.sortMode' };

export const state = {
  activeProjectId: null,
  sortMode: { sort: 'created', order: 'desc' },
  load() {
    const ap = localStorage.getItem(KEYS.activeProject);
    this.activeProjectId = ap ? Number(ap) : 1;
    const sm = localStorage.getItem(KEYS.sortMode);
    if (sm) {
      try { this.sortMode = JSON.parse(sm); } catch {}
    }
  },
  setActiveProject(id) {
    this.activeProjectId = id;
    localStorage.setItem(KEYS.activeProject, String(id));
  },
  setSortMode(sort, order) {
    this.sortMode = { sort, order };
    localStorage.setItem(KEYS.sortMode, JSON.stringify(this.sortMode));
  },
};
