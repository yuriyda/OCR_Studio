import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../../app/static/src/state';

describe('state', () => {
  beforeEach(() => localStorage.clear());

  it('default activeProjectId is 1 (Inbox)', () => {
    state.load();
    expect(state.activeProjectId).toBe(1);
  });

  it('default uiLang is ru', () => {
    state.load();
    expect(state.uiLang).toBe('ru');
  });

  it('persists uiLang to localStorage', () => {
    state.load();
    state.setUiLang('en');
    state.load();
    expect(state.uiLang).toBe('en');
  });

  it('persists panel sizes', () => {
    state.load();
    state.setPanelSizes([20, 40, 40]);
    state.load();
    expect(state.panelSizes).toEqual([20, 40, 40]);
  });

  it('default sort is created-desc', () => {
    state.load();
    expect(state.sortMode).toEqual({ sort: 'created', order: 'desc' });
  });

  it('persists sort mode', () => {
    state.load();
    state.setSortMode('name', 'asc');
    state.load();
    expect(state.sortMode).toEqual({ sort: 'name', order: 'asc' });
  });

  it('persists active project', () => {
    state.load();
    state.setActiveProject(5);
    state.load();
    expect(state.activeProjectId).toBe(5);
  });

  it('falls back to defaults on corrupted localStorage', () => {
    localStorage.setItem('ocr-state-v2', '{not valid json');
    state.load();
    expect(state.activeProjectId).toBe(1);
    expect(state.uiLang).toBe('ru');
  });
});
