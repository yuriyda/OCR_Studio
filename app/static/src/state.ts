/**
 * Local UI state with localStorage persistence.
 *
 * Maintenance notes:
 * - Do not store dynamic data here (documents, projects — those are API cache in main.ts).
 * - Only user preferences: active project, UI language, sort mode,
 *   resizable panel sizes.
 * - When InternalState shape changes — BUMP KEY ('ocr-state-v2' → '...-v3') and
 *   add a migration or fallback to defaults.
 * - `state.load()` is ALWAYS called before reading (in `boot()` in main.ts).
 */

import type { LangCode } from './types';

export interface SortMode {
  sort: 'created' | 'name' | 'size';
  order: 'asc' | 'desc';
}

interface InternalState {
  activeProjectId: number;
  sortMode: SortMode;
  uiLang: LangCode;
  panelSizes: [number, number, number];
}

const KEY = 'ocr-state-v2';

const DEFAULT: InternalState = {
  activeProjectId: 1,
  sortMode: { sort: 'created', order: 'desc' },
  uiLang: 'ru',
  panelSizes: [22, 38, 40],
};

let internal: InternalState = { ...DEFAULT };

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(internal));
  } catch {
    // private mode or quota exceeded — ignore
  }
}

export const state = {
  get activeProjectId(): number { return internal.activeProjectId; },
  get sortMode(): SortMode { return internal.sortMode; },
  get uiLang(): LangCode { return internal.uiLang; },
  get panelSizes(): [number, number, number] { return internal.panelSizes; },

  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<InternalState>;
        internal = { ...DEFAULT, ...parsed };
      } else {
        internal = { ...DEFAULT };
      }
    } catch {
      internal = { ...DEFAULT };
    }
  },
  setActiveProject(id: number): void { internal.activeProjectId = id; persist(); },
  setSortMode(sort: SortMode['sort'], order: SortMode['order']): void {
    internal.sortMode = { sort, order }; persist();
  },
  setUiLang(lang: LangCode): void { internal.uiLang = lang; persist(); },
  setPanelSizes(sizes: [number, number, number]): void { internal.panelSizes = sizes; persist(); },
};
