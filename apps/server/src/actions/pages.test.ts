import { editor_newgroup, editor_untitled } from '@nibleaf/i18n/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    page: { findFirst: database.findFirst, findMany: database.findMany, update: database.update },
    $transaction: database.transaction,
  },
}));

import { updatePage } from './pages';

type Row = {
  id: string;
  projectId: string;
  parentId: string | null;
  branchId: string;
  languageId: string;
  kind: 'PAGE' | 'GROUP';
  title: string;
  slug: string;
  path: string;
  config: null;
};

const row = (overrides: Partial<Row> = {}): Row => ({
  id: 'page-1',
  projectId: 'project-1',
  parentId: null,
  branchId: 'branch-1',
  languageId: 'lang-1',
  kind: 'PAGE',
  title: 'Untitled',
  slug: 'untitled',
  path: 'untitled',
  config: null,
  ...overrides,
});

/** A one-page project: lookups return the page, sibling-slug clash checks find nothing. */
const seed = (page: Row) => {
  let current = page;
  database.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ('slug' in where ? null : current));
  database.update.mockImplementation(async ({ data }: { data: Partial<Row> }) => {
    current = { ...current, ...data };
    return current;
  });
  database.findMany.mockImplementation(async () => [current]);
  database.transaction.mockResolvedValue([]);
};

describe('updatePage placeholder slug adoption', () => {
  beforeEach(() => {
    for (const mock of Object.values(database)) mock.mockReset();
  });

  it.each([
    ['English', editor_untitled(undefined, { locale: 'en' })],
    ['Arabic', editor_untitled(undefined, { locale: 'ar' })],
    ['French', editor_untitled(undefined, { locale: 'fr' })],
  ])('adopts the first real title as the slug for a %s placeholder page', async (_locale, placeholder) => {
    seed(row({ title: placeholder }));

    const updated = await updatePage('project-1', 'page-1', { title: 'Getting started' });

    expect(database.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Getting started', slug: 'getting-started' }) }),
    );
    expect(updated.path).toBe('getting-started');
  });

  it('adopts the title slug for a localized placeholder group', async () => {
    seed(row({ kind: 'GROUP', title: editor_newgroup(undefined, { locale: 'ar' }), slug: 'new-group-2', path: 'new-group-2' }));

    const updated = await updatePage('project-1', 'page-1', { title: 'Guides' });

    expect(updated.slug).toBe('guides');
  });

  it('keeps a hand-picked placeholder-looking slug when the title was already real', async () => {
    seed(row({ title: 'Overview' }));

    const updated = await updatePage('project-1', 'page-1', { title: 'Overview and setup' });

    expect(updated.slug).toBe('untitled');
    expect(database.transaction).not.toHaveBeenCalled();
  });
});
