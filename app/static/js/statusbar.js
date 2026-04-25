// Рендер статусной строки внизу страницы.
// Редактирование: разметку трёх секций — только тут.

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmtBytes(b) {
  if (!b) return '0 МБ';
  const mb = b / (1024 * 1024);
  return mb >= 1 ? `${Math.round(mb)} МБ` : `${Math.round(b / 1024)} КБ`;
}

export function renderStatusBar(container, { env, engine, project }) {
  const envText = env.gpu
    ? `GPU: ${escHtml(env.gpu)} · CUDA ${escHtml(env.cuda || '?')} · ${env.vram_gb || '?'} GB`
    : 'GPU: недоступно';
  const engineText = `Engine: ${escHtml(engine.name)} · ${escHtml(engine.lang || '-')} · ${escHtml(engine.status)}`;
  const projText = project
    ? `${escHtml(project.name)} · ${project.doc_count} docs · ${fmtBytes(project.total_bytes)} · обработка: ${project.processing}, очередь: ${project.queued}`
    : '';
  container.innerHTML = `
    <div class="sb-section sb-env">${envText}</div>
    <div class="sb-section sb-engine">${engineText}</div>
    <div class="sb-section sb-project">${projText}</div>
  `;
}
