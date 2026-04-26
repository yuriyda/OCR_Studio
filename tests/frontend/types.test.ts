import { describe, it, expectTypeOf } from 'vitest';
import type { Project, Document, DocStatus, OcrFormat, LangCode } from '../../app/static/src/types.ts';

describe('shared types', () => {
  it('Project has required fields', () => {
    const p: Project = { id: 1, name: 'Inbox', doc_count: 3, total_bytes: 1024, created_at: '2026-04-26T00:00:00' };
    expectTypeOf(p.id).toBeNumber();
    expectTypeOf(p.name).toBeString();
    expectTypeOf(p.total_bytes).toBeNumber();
  });

  it('Document has required fields and adaptive optional fields', () => {
    const d: Document = {
      id: 5, project_id: 1, filename: 'doc.pdf', size_bytes: 1024,
      format: 'md', lang: 'ru', status: 'queued', created_at: '2026-04-26T00:00:00',
    };
    expectTypeOf(d.format).toEqualTypeOf<OcrFormat>();
    expectTypeOf(d.status).toEqualTypeOf<DocStatus>();
  });

  it('LangCode constrained to ru | en', () => {
    expectTypeOf<LangCode>().toEqualTypeOf<'ru' | 'en'>();
  });
});
