import { Prisma } from '@nibleaf/database';
import { describe, expect, it } from 'vitest';
import {
  PAGE_TRASH_SCHEMA_VERSION,
  parsePageTrashPayload,
  trashedAudienceGrantSchema,
  trashedCommentSchema,
  trashedGitImportSourceSchema,
  trashedPageSchema,
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
  ] as const)('%s', (_model, fields, scope, schema) => {
    expect(Object.keys(schema.shape).sort()).toEqual(columns(fields, [...scope]));
  });
});

describe('parsePageTrashPayload', () => {
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
