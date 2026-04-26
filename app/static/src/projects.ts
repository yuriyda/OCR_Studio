/**
 * Render списка проектов в sidebar с индикацией активного, бейджами и размерами.
 *
 * Редактирование:
 * - INBOX_ID = 1 — захардкожено, соответствует `app/storage.py: INBOX_ID = 1`.
 *   Inbox нельзя удалить/переименовать через UI, поэтому menu для него не рендерится.
 * - Имя проекта проходит через escHtml (DOM-based) для защиты от XSS.
 * - formatBytes — из icons.ts; ничего не делаем сами.
 * - Не добавлять click-обработчики здесь; они навешиваются в main.ts через event delegation.
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
