import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../../app/static/src/state';
import type { SettingsResponse } from '../../app/static/src/api';

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

describe('settings state', () => {
  beforeEach(() => state.reset());

  it('settings starts as null until loaded', () => {
    expect(state.getSettings()).toBeNull();
  });

  it('setSettings stores config and onboarding flag', () => {
    const s: SettingsResponse = {
      hq_mode: true, hq_orientation: true, hq_unwarping: false,
      hq_textline: false, hq_chart: false, hq_seal: false,
      onboarding_seen: true,
    };
    state.setSettings(s);
    expect(state.getSettings()?.hq_mode).toBe(true);
    expect(state.isOnboardingSeen()).toBe(true);
  });

  it('reload progress null by default', () => {
    expect(state.getReloadProgress()).toBeNull();
  });

  it('setReloadProgress / clearReloadProgress', () => {
    state.setReloadProgress({ loaded: 3, total: 10, current: 'X' });
    expect(state.getReloadProgress()?.loaded).toBe(3);
    state.clearReloadProgress();
    expect(state.getReloadProgress()).toBeNull();
  });

  it('recommendation defaults to null', () => {
    expect(state.getRecommendation()).toBeNull();
  });

  it('setRecommendation persists', () => {
    state.setRecommendation({ hq_mode: 'on', reason: 'good gpu', warning: null });
    expect(state.getRecommendation()?.hq_mode).toBe('on');
  });
});
