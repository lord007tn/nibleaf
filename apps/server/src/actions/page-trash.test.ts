import { Prisma } from '@nibleaf/database';
import { describe, expect, it } from 'vitest';
import {
  fitRevisions,
  PAGE_TRASH_SCHEMA_VERSION,
  parsePageTrashPayload,
  trashedAudienceGrantSchema,
  trashedCommentSchema,
  trashedGitImportSourceSchema,
  trashedPageSchema,
  trashedRevisionSchema,
} from './page-trash';

const columns = (fields: Record<string, string>, tenantScope: string[]) =>
  Object.keys(fields)
    .filter((field) => !tenantScope.includes(field))
    .sort();

/**
 * Schema drift guard (AUTH-12). A column added to Page, Comment, AudienceGrant
 * or PageGitImportSource must be carried by the Trash payload with a default,
 * or a page trashed before the column existed could not be restored (or the
 * column would silently be lost on restore). Tenant scope is never stored per
 * row: restore takes it from the trash row.
 */
describe('Trash payload covers every restored column', () => {
  it.each([
    ['Page', Prisma.PageScalarFieldEnum, ['projectId', 'branchId', 'languageId'], trashedPageSchema],
    ['Comment', Prisma.CommentScalarFieldEnum, ['projectId'], trashedCommentSchema],
    ['AudienceGrant', Prisma.AudienceGrantScalarFieldEnum, ['projectId'], trashedAudienceGrantSchema],
    ['PageGitImportSource', Prisma.PageGitImportSourceScalarFieldEnum, ['projectId', 'branchId', 'languageId'], trashedGitImportSourceSchema],
    ['PageRevision', Prisma.PageRevisionScalarFieldEnum, ['projectId'], trashedRevisionSchema],
  ] as const)('%s', (_model, fields, scope, schema) => {
    expect(Object.keys(schema.shape).sort()).toEqual(columns(fields, [...scope]));
  });
});

describe('fitRevisions', () => {
  const base = { schemaVersion: PAGE_TRASH_SCHEMA_VERSION, pages: [{ id: 'a', title: 'A', slug: 'a' }] };
  const revision = (id: string, pageId: string, day: number, size: number) => ({
    id,
    pageId,
    userId: null,
    createdAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
    title: 'T',
    content: 'x'.repeat(size),
    description: null,
    icon: null,
    hidden: false,
    config: null,
    contentBytes: size,
    reason: 'autosave',
  });
  // Oldest to newest across two pages.
  const revisions = [revision('r1', 'a', 1, 400), revision('r2', 'b', 2, 400), revision('r3', 'a', 3, 400), revision('r4', 'b', 4, 400)];
  const bytes = (fitted: NonNullable<ReturnType<typeof fitRevisions>>) =>
    Buffer.byteLength(JSON.stringify({ ...base, revisions: fitted.revisions, revisionCounts: fitted.counts }), 'utf8');

  it('keeps everything when it fits', () => {
    const fitted = fitRevisions(base, revisions, 1_000_000);
    expect(fitted?.revisions.map((entry) => entry.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(fitted?.counts).toEqual({ a: { total: 2, kept: 2 }, b: { total: 2, kept: 2 } });
  });

  it('drops the oldest revisions across the subtree first and stays within the cap', () => {
    const full = fitRevisions(base, revisions, 1_000_000);
    if (!full) throw new Error('fits');
    const oldest = Buffer.byteLength(JSON.stringify(revisions[0]), 'utf8') + 1;
    const second = Buffer.byteLength(JSON.stringify(revisions[1]), 'utf8') + 1;
    // One byte short of the full payload: only the oldest goes.
    const one = fitRevisions(base, revisions, bytes(full) - 1);
    expect(one?.revisions.map((entry) => entry.id)).toEqual(['r2', 'r3', 'r4']);
    expect(one?.counts).toEqual({ a: { total: 2, kept: 1 }, b: { total: 2, kept: 2 } });
    // Room for exactly the two newest.
    const limit = bytes(full) - oldest - second;
    const two = fitRevisions(base, revisions, limit);
    expect(two?.revisions.map((entry) => entry.id)).toEqual(['r3', 'r4']);
    expect(two && bytes(two)).toBeLessThanOrEqual(limit);
    expect(fitRevisions(base, revisions, limit - 1)?.revisions.map((entry) => entry.id)).toEqual(['r4']);
  });

  it('keeps no history, then refuses, when the pages alone are too large', () => {
    const empty = Buffer.byteLength(
      JSON.stringify({ ...base, revisions: [], revisionCounts: { a: { total: 2, kept: 2 }, b: { total: 2, kept: 2 } } }),
      'utf8',
    );
    expect(fitRevisions(base, revisions, empty)?.revisions).toEqual([]);
    expect(fitRevisions(base, revisions, empty)?.counts).toEqual({ a: { total: 2, kept: 0 }, b: { total: 2, kept: 0 } });
    expect(fitRevisions(base, revisions, empty - 1)).toBeNull();
  });
});

describe('parsePageTrashPayload', () => {
  it('reads a version 1 payload, which has no history', () => {
    const payload = parsePageTrashPayload('t', 'root', { schemaVersion: 1, pages: [{ id: 'root', title: 'Root', slug: 'root' }] });
    expect(payload).toMatchObject({ revisions: [], revisionCounts: {} });
  });

  const page = { id: 'root', parentId: 'gone', title: 'Root', slug: 'root' };
  it('fills defaults for columns a payload predates', () => {
    const payload = parsePageTrashPayload('t', 'root', { schemaVersion: 1, pages: [page] });
    expect(payload.pages[0]).toMatchObject({
      kind: 'PAGE',
      content: '',
      hidden: false,
      icon: null,
      description: null,
      translationKey: null,
      position: 0,
    });
    expect(payload).toMatchObject({ comments: [], audienceGrants: [], gitImportSources: [] });
  });

  it('refuses a newer schema version it cannot read', () => {
    expect(() => parsePageTrashPayload('t', 'root', { schemaVersion: PAGE_TRASH_SCHEMA_VERSION + 1, pages: [page] })).toThrow(
      expect.objectContaining({ code: 'page:trash_unrestorable', details: expect.objectContaining({ reason: 'unsupported_version' }) }),
    );
  });

  it.each([
    ['no version', { pages: [page] }],
    ['no pages', { schemaVersion: 1, pages: [] }],
    ['a page without an address', { schemaVersion: 1, pages: [{ id: 'root', title: 'Root' }] }],
    ['a root that is not in the payload', { schemaVersion: 1, pages: [{ ...page, id: 'other' }] }],
    ['a child outside the subtree', { schemaVersion: 1, pages: [page, { id: 'child', parentId: 'elsewhere', title: 'C', slug: 'c' }] }],
    ['duplicate ids', { schemaVersion: 1, pages: [page, page] }],
    ['not an object', 'garbage'],
  ])('refuses %s', (_label, raw) => {
    expect(() => parsePageTrashPayload('t', 'root', raw)).toThrow(
      expect.objectContaining({ code: 'page:trash_unrestorable', details: expect.objectContaining({ reason: 'invalid_payload' }) }),
    );
  });
});
