/**
 * Drag handlers: file drop = queue upload (NOT start OCR — use /api/recognize for that),
 * document drag between projects = move via PATCH.
 *
 * Maintenance notes:
 * - DocId is a string (UUID hex). startDocDrag accepts string|number and coerces to string.
 * - Do NOT initiate fetch here — the controller (main.ts) makes API calls in onUpload/onMove.
 * - MIME 'application/x-ocr-doc' is our custom type, checked in handleDrop to distinguish
 *   "file drop" from "document move".
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
