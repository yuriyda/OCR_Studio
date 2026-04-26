import { describe, it, expect, beforeEach } from 'vitest';
import { renderProjects, INBOX_ID } from '../../app/static/src/projects';
import type { Project } from '../../app/static/src/types';
import { loadLang } from '../../app/static/src/i18n';

const sample: Project[] = [
  { id: 1, name: 'Inbox', doc_count: 3, total_bytes: 1024 * 1024, created_at: '2026-04-26T00:00:00' },
  { id: 2, name: 'Reports', doc_count: 5, total_bytes: 5 * 1024 * 1024, created_at: '2026-04-26T00:00:00' },
];

describe('renderProjects', () => {
  beforeEach(() => { loadLang('ru'); document.body.innerHTML = '<div id="c"></div>'; });

  it('renders all projects', () => {
    const c = document.getElementById('c')!;
    renderProjects(c, sample, 1);
    expect(c.querySelectorAll('.project-item').length).toBe(2);
  });

  it('renders project size in МБ', () => {
    const c = document.getElementById('c')!;
    renderProjects(c, sample, 1);
    expect(c.textContent).toContain('1.0 МБ');
    expect(c.textContent).toContain('5.0 МБ');
  });

  it('marks active project', () => {
    const c = document.getElementById('c')!;
    renderProjects(c, sample, 2);
    const items = c.querySelectorAll('.project-item');
    expect(items[1]?.classList.contains('active')).toBe(true);
    expect(items[0]?.classList.contains('active')).toBe(false);
  });

  it('hides menu for Inbox (id=1) but shows for others', () => {
    const c = document.getElementById('c')!;
    renderProjects(c, sample, 1);
    expect(c.querySelector('[data-id="1"] .proj-menu')).toBeNull();
    expect(c.querySelector('[data-id="2"] .proj-menu')).toBeTruthy();
  });

  it('escapes XSS in project name', () => {
    const c = document.getElementById('c')!;
    renderProjects(c, [{ id: 5, name: '<script>alert(1)</script>', doc_count: 0, total_bytes: 0, created_at: 'x' }], 5);
    expect(c.innerHTML).not.toContain('<script>');
    expect(c.innerHTML).toContain('&lt;script&gt;');
  });

  it('INBOX_ID equals 1', () => expect(INBOX_ID).toBe(1));
});
