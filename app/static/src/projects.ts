/**
 * Render the project list in the sidebar with active indicator, badges, and sizes.
 *
 * Maintenance notes:
 * - INBOX_ID = 1 and WATCH_PROJECT_ID = 2 are hardcoded system projects, matching
 *   `app/storage.py: INBOX_ID = 1` and `WATCH_PROJECT_ID = 2`.
 *   Protected projects cannot be deleted/renamed — no menu is rendered for them.
 * - Use `isProtectedProject(p)` to check whether a project is system-protected.
 * - Project names pass through escHtml (DOM-based) for XSS protection.
 * - formatBytes — from icons.ts; nothing computed here directly.
 * - Do not attach click handlers here; they are added in main.ts via event delegation.
 */

import type { Project } from './types';
import { formatBytes } from './icons';
import { t } from './i18n';

export const INBOX_ID = 1;
export const WATCH_PROJECT_ID = 2;

/** Returns true for system-protected projects (Inbox, Watch) that cannot be renamed or deleted. */
export function isProtectedProject(p: { id: number }): boolean {
  return p.id === INBOX_ID || p.id === WATCH_PROJECT_ID;
}

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function renderProjects(container: HTMLElement, projects: Project[], activeId: number): void {
  container.innerHTML = projects.map((p) => {
    const protected_ = isProtectedProject(p);
    const active = p.id === activeId ? 'active' : '';
    const menu = protected_ ? '' : '<span class="proj-menu cursor-pointer text-text-muted px-1">⋯</span>';
    const icon = p.id === INBOX_ID ? '📥' : p.id === WATCH_PROJECT_ID ? '👁' : '📁';
    const displayName = p.id === INBOX_ID
      ? t('projects.inbox')
      : p.id === WATCH_PROJECT_ID
        ? t('projects.watch')
        : p.name;
    return `
      <div class="project-item doc-item ${active}" data-id="${p.id}">
        <span>${icon}</span>
        <span class="flex-1 truncate">${escHtml(displayName)}</span>
        <span class="text-xs text-text-muted whitespace-nowrap">${p.doc_count} · ${formatBytes(p.total_bytes)}</span>
        ${menu}
      </div>`;
  }).join('');
}
