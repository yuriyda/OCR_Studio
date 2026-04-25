import { describe, it, expect, beforeEach } from 'vitest';
import { renderProjects, INBOX_ID } from '../../app/static/js/projects.js';

describe('projects.renderProjects', () => {
  let container;
  beforeEach(() => {
    document.body.innerHTML = '<div id="proj-list"></div>';
    container = document.getElementById('proj-list');
  });

  it('renders all projects', () => {
    renderProjects(container, [
      { id: 1, name: 'Inbox', doc_count: 3 },
      { id: 2, name: 'P', doc_count: 0 },
    ], 1);
    expect(container.querySelectorAll('.project-item').length).toBe(2);
  });

  it('marks active project', () => {
    renderProjects(container, [{ id: 1, name: 'Inbox', doc_count: 0 }], 1);
    expect(container.querySelector('.project-item.active')).toBeTruthy();
  });

  it('hides menu for Inbox (id=1)', () => {
    renderProjects(container, [
      { id: 1, name: 'Inbox', doc_count: 0 },
      { id: 2, name: 'X', doc_count: 0 },
    ], 1);
    const items = container.querySelectorAll('.project-item');
    expect(items[0].querySelector('.proj-menu')).toBeFalsy();
    expect(items[1].querySelector('.proj-menu')).toBeTruthy();
  });

  it('shows doc_count', () => {
    renderProjects(container, [{ id: 1, name: 'Inbox', doc_count: 5 }], 1);
    expect(container.textContent).toContain('5');
  });

  it('exports INBOX_ID = 1', () => {
    expect(INBOX_ID).toBe(1);
  });
});
