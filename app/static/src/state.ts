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
 * - Transient slices (settings, reloadProgress, recommendation) are NOT persisted
 *   to localStorage — they are fetched fresh from the API on each boot.
 * - `state.reset()` is provided for tests; it clears ALL transient slices.
 */

import type { LangCode } from './types';
import type { SettingsResponse } from './api';

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

// ---------------------------------------------------------------------------
// Transient slices — NOT persisted to localStorage
// ---------------------------------------------------------------------------

export interface ReloadProgress {
  loaded: number | null;
  total: number;
  current: string | null;
}

export interface Recommendation {
  hq_mode: 'on' | 'off';
  reason: string;
  warning: string | null;
}

let _settings: SettingsResponse | null = null;
let _reload: ReloadProgress | null = null;
let _recommendation: Recommendation | null = null;

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

  // Reset ALL transient slices (used in tests; safe to call in production on logout).
  reset(): void {
    _settings = null;
    _reload = null;
    _recommendation = null;
  },

  // Settings slice
  getSettings(): SettingsResponse | null { return _settings; },
  setSettings(s: SettingsResponse): void { _settings = s; },
  isOnboardingSeen(): boolean { return !!_settings?.onboarding_seen; },

  // Reload-progress slice
  getReloadProgress(): ReloadProgress | null { return _reload; },
  setReloadProgress(p: ReloadProgress): void { _reload = p; },
  clearReloadProgress(): void { _reload = null; },

  // Recommendation slice
  getRecommendation(): Recommendation | null { return _recommendation; },
  setRecommendation(r: Recommendation): void { _recommendation = r; },
};
