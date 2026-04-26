import { describe, it, expectTypeOf } from 'vitest';
import type {
  Project, Document, DocStatus, OcrFormat, LangCode,
  UploadResponse, RecognizeResponse, UploadWarning,
} from '../../app/static/src/types.ts';

describe('shared types', () => {
  it('Project.id is number (sqlite INTEGER PRIMARY KEY AUTOINCREMENT)', () => {
    const p: Project = { id: 1, name: 'Inbox', doc_count: 3, total_bytes: 1024, created_at: '2026-04-26T00:00:00' };
    expectTypeOf(p.id).toBeNumber();
    expectTypeOf(p.name).toBeString();
    expectTypeOf(p.total_bytes).toBeNumber();
  });

  it('Document.id is string (sqlite TEXT PRIMARY KEY, uuid hex)', () => {
    const d: Document = {
      id: 'a1b2c3d4e5f6', project_id: 1, filename: 'doc.pdf', size_bytes: 1024,
      format: 'md', lang: 'ru', status: 'queued', created_at: '2026-04-26T00:00:00',
      started_at: null, finished_at: null,
      page_count: null, current_page: null, progress_percent: null,
      elapsed_seconds: null, eta_seconds: null, error: null,
      available_formats: ['md'],
    };
    expectTypeOf(d.id).toBeString();
    expectTypeOf(d.format).toEqualTypeOf<OcrFormat>();
    expectTypeOf(d.status).toEqualTypeOf<DocStatus>();
    expectTypeOf(d.error).toEqualTypeOf<string | null>();
    expectTypeOf(d.page_count).toEqualTypeOf<number | null>();
  });

  it('LangCode constrained to ru | en', () => {
    expectTypeOf<LangCode>().toEqualTypeOf<'ru' | 'en'>();
  });

  it('UploadResponse.ids matches Document.id type (string)', () => {
    const r: UploadResponse = { ids: ['abc123def456'], warnings: [] };
    expectTypeOf(r.ids).toEqualTypeOf<string[]>();
  });

  it('RecognizeResponse.doc_ids matches Document.id type (string)', () => {
    const r: RecognizeResponse = { started: 2, doc_ids: ['a1b2', 'c3d4'] };
    expectTypeOf(r.doc_ids).toEqualTypeOf<string[]>();
  });

  it('UploadWarning.id matches Document.id type (string)', () => {
    const w: UploadWarning = { id: 'a1b2c3d4', type: 'long_processing', pages: 87 };
    expectTypeOf(w.id).toBeString();
  });
});
