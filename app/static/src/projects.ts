/**
 * Render the project list in the sidebar with active indicator, badges, and sizes.
 *
 * Maintenance notes:
 * - INBOX_ID = 1 — hardcoded, matches `app/storage.py: INBOX_ID = 1`.
 *   Inbox cannot be deleted/renamed via UI, so no menu is rendered for it.
 * - Project names pass through escHtml (DOM-based) for XSS protection.
 * - formatBytes — from icons.ts; nothing computed here directly.
 * - Do not attach click handlers here; they are added in main.ts via event delegation.
 */

import type { Project } from './types';
import { formatBytes } from './icons';

export const INBOX_ID = 1;

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function renderProjects(container: HTMLElement, projects: Project[], activeId: number): void {
  container.innerHTML = projects.map((p) => {
    const isInbox = p.id === INBOX_ID;
    const active = p.id === activeId ? 'active' : '';
    const menu = isInbox ? '' : '<span class="proj-menu cursor-pointer text-text-muted px-1">⋯</span>';
    const icon = isInbox ? '📥' : '📁';
    return `
      <div class="project-item doc-item ${active}" data-id="${p.id}">
        <span>${icon}</span>
        <span class="flex-1 truncate">${escHtml(p.name)}</span>
        <span class="text-xs text-text-muted whitespace-nowrap">${p.doc_count} · ${formatBytes(p.total_bytes)}</span>
        ${menu}
      </div>`;
  }).join('');
}
