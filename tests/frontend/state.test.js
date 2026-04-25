import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../../app/static/js/state.js';

describe('state', () => {
  beforeEach(() => {
    localStorage.clear();
    state.activeProjectId = null;
    state.sortMode = { sort: 'created', order: 'desc' };
  });

  it('load defaults to inbox when nothing in storage', () => {
    state.load();
    expect(state.activeProjectId).toBe(1);
  });

  it('setActiveProject persists to localStorage', () => {
    state.setActiveProject(42);
    expect(localStorage.getItem('ocr.activeProjectId')).toBe('42');
  });

  it('load restores active project from storage', () => {
    localStorage.setItem('ocr.activeProjectId', '7');
    state.load();
    expect(state.activeProjectId).toBe(7);
  });

  it('setSortMode persists', () => {
    state.setSortMode('name', 'asc');
    state.activeProjectId = null;
    state.load();
    expect(state.sortMode).toEqual({ sort: 'name', order: 'asc' });
  });
});
