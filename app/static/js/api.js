// Обёртки fetch к OCR-API. Без бизнес-логики.
// Редактирование: только адреса/методы; обработку ошибок не размазывать.

async function _json(res) {
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`HTTP ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  listProjects: () => fetch('/api/projects').then(_json),
  createProject: (name) => fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(_json),
  renameProject: (id, name) => fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(_json),
  deleteProject: (id) => fetch(`/api/projects/${id}`, { method: 'DELETE' }),

  listDocuments: (projectId, sort, order) => {
    const params = new URLSearchParams();
    if (projectId != null) params.set('project_id', projectId);
    if (sort) params.set('sort', sort);
    if (order) params.set('order', order);
    return fetch(`/api/status?${params}`).then(_json);
  },
  uploadDocs: (filesList, format, lang, projectId) => {
    const fd = new FormData();
    for (const f of filesList) fd.append('files', f);
    fd.append('format', format);
    fd.append('lang', lang);
    if (projectId != null) fd.append('project_id', projectId);
    return fetch('/api/ocr', { method: 'POST', body: fd }).then(_json);
  },
  moveDocument: (id, projectId) => fetch(`/api/documents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId }),
  }).then(_json),
  deleteDocument: (id) => fetch(`/api/documents/${id}`, { method: 'DELETE' }),

  getMarkdown: (id) => fetch(`/api/markdown/${id}`).then(_json),
  getRendered: (id) => fetch(`/api/rendered/${id}`).then(_json),
  getPreview: (id) => fetch(`/api/preview/${id}`).then(_json),
  getSystemInfo: () => fetch('/api/system').then(_json),
  getLimits: () => fetch('/api/limits').then(_json),
  projectZipUrl: (projectId) => `/api/projects/${projectId}/zip`,
};
