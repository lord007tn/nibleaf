import type { Prisma } from '@nibleaf/database';
import { editor_newgroup, editor_untitled } from '@nibleaf/i18n/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
}));
const recordEdit = vi.hoisted(() => vi.fn());
vi.mock('./platform-events', () => ({ logFirstContentEdit: recordEdit }));
vi.mock('./branches', () => ({ assertBranchInProject: async () => ({ id: 'branch-1' }), getDefaultBranch: async () => ({ id: 'branch-1' }) }));

vi.mock('@nibleaf/database', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    page: {
      findFirst: database.findFirst,
      findFirstOrThrow: database.findFirst,
      findMany: database.findMany,
      update: database.update,
      updateMany: database.updateMany,
    },
    $transaction: database.transaction,
  },
}));

import { reorderPages, updatePage } from './pages';

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
  content: string;
  updatedAt: Date;
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
  content: 'Existing documentation',
  updatedAt: new Date('2026-11-02T00:00:00.000Z'),
  ...overrides,
});

/** A one-page project: lookups return the page, sibling-slug clash checks find nothing. */
const seed = (page: Row) => {
  let current = page;
  database.queryRaw.mockResolvedValue([]);
  database.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ('slug' in where ? null : current));
  database.update.mockImplementation(async ({ data }: { data: Partial<Row> }) => {
    current = { ...current, ...data };
    return current;
  });
  database.findMany.mockImplementation(async () => [current]);
  database.updateMany.mockResolvedValue({ count: 1 });
  // Interactive transactions run their callback against the same page client;
  // batch transactions resolve their queries.
  database.transaction.mockImplementation(async (work: unknown) =>
    typeof work === 'function'
      ? (work as (tx: unknown) => Promise<unknown>)({
          $queryRaw: database.queryRaw,
          page: {
            findFirst: database.findFirst,
            findFirstOrThrow: database.findFirst,
            findMany: database.findMany,
            update: database.update,
            updateMany: database.updateMany,
          },
        })
      : Promise.all(work as Promise<unknown>[]),
  );
};

const seedTree = (initial: Row[]) => {
  let current = structuredClone(initial);
  database.queryRaw.mockResolvedValue([]);
  database.findMany.mockImplementation(async () => structuredClone(current));
  const update = async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
    const index = current.findIndex((page) => page.id === where.id);
    const page = current[index];
    if (!page) throw new Error('Missing page fixture');
    current[index] = { ...page, ...data };
    return current[index];
  };
  database.update.mockImplementation(update);
  database.updateMany.mockImplementation(async (args) => {
    await update(args);
    return { count: 1 };
  });
  database.transaction.mockImplementation(async (work) => {
    const before = structuredClone(current);
    try {
      return typeof work === 'function'
        ? await work({
            $queryRaw: database.queryRaw,
            page: { findMany: database.findMany, update: database.update, updateMany: database.updateMany },
          })
        : await Promise.all(work);
    } catch (error) {
      current = before;
      throw error;
    }
  });
  return () => current;
};

describe('updatePage placeholder slug adoption', () => {
  beforeEach(() => {
    for (const mock of Object.values(database)) mock.mockReset();
    recordEdit.mockClear();
  });

  it('counts a saved content change, not metadata, identical autosave, or surrounding whitespace', async () => {
    seed(row({ title: 'Guide', slug: 'guide' }));
    await updatePage('project-1', 'page-1', { hidden: true }, 'author-1');
    await updatePage('project-1', 'page-1', { content: 'Existing documentation' }, 'author-1');
    await updatePage('project-1', 'page-1', { content: '  Existing documentation\n' }, 'author-1');
    expect(recordEdit).not.toHaveBeenCalled();
    await updatePage('project-1', 'page-1', { content: 'A useful new instruction' }, 'author-1');
    expect(recordEdit).toHaveBeenCalledExactlyOnceWith('author-1', 'project-1');
  });

  it('does not record an edit when the project-scoped update fails', async () => {
    seed(row());
    database.findFirst.mockResolvedValue(null);
    await expect(updatePage('other-project', 'page-1', { content: 'new' }, 'author-1')).rejects.toThrow();
    expect(recordEdit).not.toHaveBeenCalled();
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
    expect(database.update).toHaveBeenCalledWith(expect.objectContaining({ data: { title: 'Overview and setup' } }));
  });
});

describe('updatePage structural changes', () => {
  beforeEach(() => {
    for (const mock of Object.values(database)) mock.mockReset();
  });

  it('keeps branch and language helper reads on the supplied transaction', async () => {
    const branches = await vi.importActual<typeof import('./branches')>('./branches');
    const languages = await vi.importActual<typeof import('./languages')>('./languages');
    const branch = { id: 'branch', projectId: 'project' };
    const language = { id: 'language', projectId: 'project' };
    const tx = {
      branch: { findFirst: vi.fn().mockResolvedValue(branch), findMany: vi.fn().mockResolvedValue([branch]) },
      language: { findFirst: vi.fn().mockResolvedValue(language), findMany: vi.fn().mockResolvedValue([language]) },
    };
    const client = tx as unknown as Prisma.TransactionClient;
    await expect(branches.getDefaultBranch('project', client)).resolves.toEqual(branch);
    await expect(branches.assertBranchInProject('project', 'branch', client)).resolves.toEqual(branch);
    await expect(languages.getDefaultLanguage('project', client)).resolves.toEqual(language);
    await expect(languages.assertLanguageInProject('project', 'language', client)).resolves.toEqual(language);
    expect(tx.branch.findFirst).toHaveBeenCalledOnce();
    expect(tx.language.findFirst).toHaveBeenCalledOnce();
  });

  it('locks only the page for the real title/content autosave payload', async () => {
    seed(row({ title: 'Guide', slug: 'guide', path: 'guide' }));
    await updatePage('project-1', 'page-1', { title: 'Updated guide', content: 'Autosaved content' });
    const sql = database.queryRaw.mock.calls.map(([parts]) => parts.join('?'));
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('FROM "page" WHERE id =');
    expect(sql[0]).toContain('FOR NO KEY UPDATE');
  });

  it('keeps legacy custom slugs unchanged during title/content autosave', async () => {
    seed(row({ title: 'Guide', slug: 'API_v1', path: 'API_v1' }));
    const updated = await updatePage('project-1', 'page-1', { title: 'Updated guide', content: 'Autosaved content' });
    expect(updated).toMatchObject({ slug: 'API_v1', path: 'API_v1' });
    expect(database.queryRaw).toHaveBeenCalledOnce();
    expect(database.queryRaw.mock.calls[0]?.[0].join('?')).toContain('FROM "page" WHERE id =');
  });

  it('uses a single page lock for a config merge', async () => {
    seed(row({ title: 'Guide', slug: 'guide', path: 'guide' }));
    await updatePage('project-1', 'page-1', { config: { hideToc: true } });
    expect(database.queryRaw).toHaveBeenCalledOnce();
    expect(database.queryRaw.mock.calls[0]?.[0].join('?')).toContain('FROM "page" WHERE id =');
  });

  it('releases a page lock before retrying a newly structural edit in project-first order', async () => {
    seed(row());
    database.findFirst.mockResolvedValueOnce(row({ title: 'Guide', slug: 'guide', path: 'guide' }));
    const updated = await updatePage('project-1', 'page-1', { title: 'Getting started', content: 'Saved content' });
    expect(updated.slug).toBe('getting-started');
    expect(database.transaction).toHaveBeenCalledTimes(2);
    const sql = database.queryRaw.mock.calls.map(([parts]) => parts.join('?'));
    expect(sql[0]).toContain('FROM "page" WHERE id =');
    expect(sql[1]).toContain('FROM "project"');
    expect(sql[2]).toContain('ORDER BY id FOR NO KEY UPDATE');
  });

  it('does not let a pre-existing duplicate elsewhere prevent an unrelated move', async () => {
    const current = seedTree([
      row({ id: 'legacy-one', slug: 'duplicate', path: 'duplicate' }),
      row({ id: 'legacy-two', slug: 'duplicate', path: 'duplicate' }),
      row({ id: 'group', slug: 'guides', path: 'guides' }),
      row({ id: 'moving', slug: 'intro', path: 'intro' }),
    ]);
    await reorderPages('project-1', { items: [{ id: 'moving', parentId: 'group', position: 0 }] });
    expect(current().find((page) => page.id === 'moving')?.path).toBe('guides/intro');
    expect(current().filter((page) => page.path === 'duplicate')).toHaveLength(2);
  });

  it('does not overwrite a concurrent URL change during content autosave', async () => {
    seed(row({ title: 'Guide', slug: 'guide', path: 'guide' }));
    const write = database.update.getMockImplementation();
    database.update.mockImplementationOnce(async (args) => {
      await write?.({ data: { slug: 'handbook', path: 'handbook' } });
      return write?.(args);
    });
    const updated = await updatePage('project-1', 'page-1', { content: 'Autosaved content' });
    expect(updated).toMatchObject({ slug: 'handbook', path: 'handbook', content: 'Autosaved content' });
  });

  it('rejects a reorder that would give two siblings the same URL before writing', async () => {
    seed(row());
    database.findMany.mockResolvedValue([
      row({ id: 'group', kind: 'GROUP', slug: 'guides', path: 'guides' }),
      row({ id: 'moving', slug: 'intro', path: 'intro' }),
      row({ id: 'existing', parentId: 'group', slug: 'intro', path: 'guides/intro' }),
    ]);
    await expect(reorderPages('project-1', { items: [{ id: 'moving', parentId: 'group', position: 0 }] })).rejects.toMatchObject({
      code: 'database:conflict',
    });
    expect(database.update).not.toHaveBeenCalled();
  });

  it('checks the complete proposed tree when two pages move into the same group', async () => {
    seedTree([
      row({ id: 'left', slug: 'left', path: 'left' }),
      row({ id: 'right', slug: 'right', path: 'right' }),
      row({ id: 'one', parentId: 'left', slug: 'intro', path: 'left/intro' }),
      row({ id: 'two', parentId: 'right', slug: 'intro', path: 'right/intro' }),
    ]);
    await expect(
      reorderPages('project-1', {
        items: [
          { id: 'one', parentId: null, position: 0 },
          { id: 'two', parentId: null, position: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'database:conflict' });
    expect(database.updateMany).not.toHaveBeenCalled();
  });

  it('allows a sibling swap and recomputes descendant paths atomically', async () => {
    const current = seedTree([
      row({ id: 'left', slug: 'left', path: 'left' }),
      row({ id: 'right', slug: 'right', path: 'right' }),
      row({ id: 'one', parentId: 'left', slug: 'intro', path: 'left/intro' }),
      row({ id: 'two', parentId: 'right', slug: 'intro', path: 'right/intro' }),
      row({ id: 'child', parentId: 'one', slug: 'child', path: 'left/intro/child' }),
    ]);
    await reorderPages('project-1', {
      items: [
        { id: 'one', parentId: 'right', position: 0 },
        { id: 'two', parentId: 'left', position: 0 },
      ],
    });
    expect(current().find((page) => page.id === 'one')?.path).toBe('right/intro');
    expect(current().find((page) => page.id === 'two')?.path).toBe('left/intro');
    expect(current().find((page) => page.id === 'child')?.path).toBe('right/intro/child');
    expect(database.transaction).toHaveBeenCalledOnce();
  });

  it('rolls back a move when subtree path persistence fails', async () => {
    const initial = [row({ id: 'group', slug: 'guides', path: 'guides' }), row({ id: 'moving', slug: 'intro', path: 'intro' })];
    const current = seedTree(initial);
    database.update.mockRejectedValueOnce(new Error('path write failed'));
    await expect(reorderPages('project-1', { items: [{ id: 'moving', parentId: 'group', position: 0 }] })).rejects.toThrow('path write failed');
    expect(current()).toEqual(initial);
  });

  it('commits the slug change and the path recomputation in one transaction', async () => {
    seed(row({ title: 'Guide', slug: 'guide', path: 'guide' }));
    await updatePage('project-1', 'page-1', { slug: 'handbook' });
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(database.transaction.mock.calls[0]?.[0]).toBeTypeOf('function');
    expect(database.transaction.mock.calls[0]?.[1]).toMatchObject({ timeout: expect.any(Number) });
  });

  it('fails the whole change when the paths cannot be recomputed', async () => {
    seed(row({ title: 'Guide', slug: 'guide', path: 'guide' }));
    database.findMany.mockRejectedValueOnce(new Error('connection lost'));
    await expect(updatePage('project-1', 'page-1', { slug: 'handbook' })).rejects.toThrow('connection lost');
    // The page write happened inside the transaction that failed, so it rolls back with it.
    expect(database.update).toHaveBeenCalledOnce();
    expect(database.transaction).toHaveBeenCalledOnce();
  });
});

describe('updatePage non-Latin slugs', () => {
  beforeEach(() => {
    for (const mock of Object.values(database)) mock.mockReset();
  });

  it('gives an Arabic title an Arabic slug instead of the "page" placeholder', async () => {
    seed(row({ title: editor_untitled(undefined, { locale: 'ar' }) }));

    const updated = await updatePage('project-1', 'page-1', { title: 'المصادقة' });

    expect(updated.slug).toBe('المصادقة');
    expect(updated.path).toBe('المصادقة');
  });

  it('keeps mixed Arabic and Latin words in an explicit slug', async () => {
    seed(row({ title: 'Overview' }));

    const updated = await updatePage('project-1', 'page-1', { slug: 'API الوصول' });

    expect(updated.slug).toBe('api-الوصول');
  });

  it('falls back to "page" only when the title has no letters or digits at all', async () => {
    seed(row({ title: editor_untitled(undefined, { locale: 'en' }) }));

    const updated = await updatePage('project-1', 'page-1', { title: '🚀🎉' });

    expect(updated.slug).toBe('page');
  });
});

describe('updatePage revision precondition', () => {
  const readRevision = new Date('2026-11-02T00:00:00.000Z');
  const notFoundError = () => Object.assign(new Error('No record was found for an update.'), { code: 'P2025' });

  beforeEach(() => {
    for (const mock of Object.values(database)) mock.mockReset();
    recordEdit.mockClear();
  });

  it('refuses before writing when the page already changed since the expected revision', async () => {
    seed(row({ title: 'Guide', slug: 'guide' }));
    await expect(
      updatePage('project-1', 'page-1', { content: 'new' }, 'author-1', { expectedUpdatedAt: new Date('2026-11-01T00:00:00.000Z') }),
    ).rejects.toMatchObject({ code: 'database:conflict', details: { id: 'page-1', reason: 'revision_conflict' } });
    expect(database.update).not.toHaveBeenCalled();
    expect(recordEdit).not.toHaveBeenCalled();
  });

  it('makes the final write conditional on the revision that was read', async () => {
    seed(row({ title: 'Guide', slug: 'guide' }));
    await updatePage('project-1', 'page-1', { content: 'new' }, 'author-1', { expectedUpdatedAt: readRevision });
    expect(database.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'page-1', updatedAt: readRevision } }));
    expect(recordEdit).toHaveBeenCalledOnce();
  });

  it('turns an edit that lands between the read and the write into a conflict', async () => {
    seed(row({ title: 'Guide', slug: 'guide' }));
    database.update.mockRejectedValueOnce(notFoundError());
    await expect(updatePage('project-1', 'page-1', { content: 'new' }, 'author-1', { expectedUpdatedAt: readRevision })).rejects.toMatchObject({
      code: 'database:conflict',
      details: { reason: 'revision_conflict' },
    });
    expect(recordEdit).not.toHaveBeenCalled();
  });

  it('leaves dashboard callers without a precondition unchanged', async () => {
    seed(row({ title: 'Guide', slug: 'guide' }));
    await updatePage('project-1', 'page-1', { hidden: true }, 'author-1');
    expect(database.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'page-1' } }));
    database.update.mockRejectedValueOnce(notFoundError());
    await expect(updatePage('project-1', 'page-1', { hidden: false }, 'author-1')).rejects.toMatchObject({ code: 'P2025' });
  });
});
