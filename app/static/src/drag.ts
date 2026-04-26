/**
 * Drag-handlers: drop файлов = постановка в очередь (НЕ старт OCR — для этого Task 9 endpoint
 * /api/recognize), drag документов между проектами = move через PATCH.
 *
 * Редактирование:
 * - DocId — string (UUID hex). startDocDrag принимает string|number и форсит string.
 * - НЕ запускать здесь fetch — controller (main.ts) делает API calls в onUpload/onMove.
 * - MIME 'application/x-ocr-doc' — наш custom тип, проверяется в handleDrop для разделения
 *   "drop файла" vs "перенос документа".
 */

export interface DropHandlers {
  onUpload(files: File[], projectId: number): void;
  onMove(docId: string, projectId: number): void | Promise<void>;
}

export function handleDrop(e: DragEvent, projectId: number, handlers: DropHandlers): void {
  e.preventDefault();
  const dt = e.dataTransfer;
  if (!dt) return;
  const docId = dt.getData('application/x-ocr-doc');
  if (docId) {
    handlers.onMove(docId, projectId);
    return;
  }
  const files = Array.from(dt.files);
  if (files.length) handlers.onUpload(files, projectId);
}

export function startDocDrag(e: DragEvent, docId: string | number): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData('application/x-ocr-doc', String(docId));
  e.dataTransfer.effectAllowed = 'move';
}
