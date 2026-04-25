// Различение drop-источника: внешний файл (upload) vs внутренний документ (move).
// Редактирование: тип данных application/x-ocr-doc — единый протокол; не менять.

export const DOC_MIME = 'application/x-ocr-doc';

export function handleDrop(event, targetProjectId, { onUpload, onMove }) {
  event.preventDefault();
  const types = event.dataTransfer.types || [];
  if (types.includes('Files') && event.dataTransfer.files.length) {
    onUpload(Array.from(event.dataTransfer.files), targetProjectId);
    return;
  }
  if (Array.from(types).includes(DOC_MIME)) {
    const docId = event.dataTransfer.getData(DOC_MIME);
    if (docId) onMove(docId, targetProjectId);
  }
}

export function startDocDrag(event, docId) {
  event.dataTransfer.setData(DOC_MIME, docId);
  event.dataTransfer.effectAllowed = 'move';
}
