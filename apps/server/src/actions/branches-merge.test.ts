import { beforeEach, describe, expect, it, vi } from 'vitest';

type Sql = { text: string; values: unknown[] };
const { sql, DbNull } = vi.hoisted(() => {
  const render = (value: unknown) => (value && typeof value === 'object' && 'text' in value ? (value as { text: string }).text : '?');
  return {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: strings.reduce((acc, part, i) => acc + (i > 0 ? render(values[i - 1]) : '') + part, ''),
      values,
    }),
    DbNull: Symbol('DbNull'),
  };
});

const db = vi.hoisted(() => ({
  branch: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  page: { deleteMany: vi.fn(), updateMany: vi.fn(), createMany: vi.fn(), count: vi.fn() },
  pageGitImportSource: { findMany: vi.fn(), createMany: vi.fn() },
  language: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock('@nibleaf/database', () => ({ prisma: db, Prisma: { sql, DbNull } }));

import { buildForkBaseline, changedOnMainSinceFork, forkPointOf, inheritForkBaseline, pageContentHash } from './branch-fork';
import { createBranch, getMergePreview, mergeBranch } from './branches';

const FORKED = new Date('2026-11-01T10:00:00.000Z');
const LATER = new Date('2026-11-02T10:00:00.000Z');
const CREATED = new Date('2026-10-31T09:00:00.000Z');

type Row = {
  id: string;
  parentId: string | null;
  kind: 'PAGE' | 'GROUP';
  title: string;
  slug: string;
  path: string;
  languageId: string;
  position: number;
  updatedAt: Date;
  hash: string;
};
const row = (id: string, hash: string, extra: Partial<Row> = {}): Row => ({
  id,
  parentId: null,
  kind: 'PAGE',
  title: id.toUpperCase(),
  slug: id,
  path: id,
  languageId: 'lang-en',
  position: 0,
  updatedAt: FORKED,
  hash,
  ...extra,
});
/** A v2 baseline of `pages`, each copied as `copy-<id>` with an equal hash. */
const baselineOf = (pages: Row[]) => {
  const hashes = new Map(pages.flatMap((p) => [[p.id, p.hash] as const, [`copy-${p.id}`, p.hash] as const]));
  return buildForkBaseline(
    pages,
    (id) => `copy-${id}`,
    (id) => hashes.get(id) ?? '',
  );
};
const stored = (pages: Row[]) => JSON.parse(JSON.stringify(baselineOf(pages)));
const fork = (pages: Row[]) => forkPointOf({ createdAt: CREATED, forkedAt: FORKED, forkBaseline: stored(pages) }).baseline;
const codes = new Map([
  ['lang-en', 'en'],
  ['lang-ar', 'ar'],
]);

/** Every raw statement, in order, so tests can check the lock order. */
const statements: string[] = [];
let versionRow: { createdAt: Date; forkedAt: Date | null; forkBaseline: unknown } | undefined;
let pageRows: Array<Row & { branchId?: string }> = [];
/** Main pages the fresh post-lock check finds that the locked read did not. */
let appearedRows: Row[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  statements.length = 0;
  appearedRows = [];
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.branch.findMany.mockResolvedValue([{ id: 'main', isDefault: true, createdAt: CREATED, forkedAt: null }]);
  db.branch.findFirst.mockImplementation(async ({ where }) => (where.name ? null : { id: where.id, isDefault: where.id === 'main' }));
  db.language.findMany.mockResolvedValue([...codes].map(([id, code]) => ({ id, code })));
  db.page.count.mockResolvedValue(0);
  db.pageGitImportSource.findMany.mockResolvedValue([]);
  db.$queryRaw.mockImplementation(async (query: Sql) => {
    statements.push(query.text.replace(/\s+/g, ' ').trim());
    if (query.text.includes('FROM "branch"')) return versionRow ? [versionRow] : [];
    if (query.text.includes('NOT ("id" = ANY(')) return appearedRows;
    if (query.text.includes('FOR UPDATE') && query.text.includes('= ANY(')) return [];
    if (query.text.includes('FROM "page"')) return pageRows;
    return [];
  });
});

describe('pageContentHash', () => {
  it('is #326’s expression: a JSON tuple of the content fields, in its order, without parent or position', () => {
    // Stored baselines depend on this exact expression: #326 reads them back.
    expect((pageContentHash() as unknown as Sql).text).toBe(
      'md5(json_build_array("kind", "title", "slug", "icon", "description", "content", "config", "translationKey", "hidden")::text)',
    );
  });
});

describe('fork baselines', () => {
  it('records every v2 field for each main page', () => {
    const guide = row('guide', 'g', { kind: 'GROUP', position: 3, updatedAt: LATER });
    expect(baselineOf([guide, row('billing', 'b', { parentId: 'guide', path: 'guide/billing' })])).toEqual({
      version: 2,
      pages: {
        guide: {
          copyId: 'copy-guide',
          hash: 'g',
          copyHash: 'g',
          parentId: null,
          position: 3,
          updatedAt: LATER.toISOString(),
          title: 'GUIDE',
          path: 'guide',
          languageId: 'lang-en',
          kind: 'GROUP',
        },
        billing: expect.objectContaining({ copyId: 'copy-billing', parentId: 'guide', path: 'guide/billing', kind: 'PAGE' }),
      },
    });
  });

  it.each([
    ['no fork time', { forkedAt: null, forkBaseline: stored([row('a', 'h')]) }],
    ['no baseline', { forkedAt: FORKED, forkBaseline: null }],
    ['the unreleased v1 shape', { forkedAt: FORKED, forkBaseline: { version: 1, pages: {} } }],
    ['a malformed entry', { forkedAt: FORKED, forkBaseline: { version: 2, pages: { a: { hash: 'h' } } } }],
  ])('treats %s as no baseline', (_label, branch) => {
    expect(forkPointOf({ createdAt: CREATED, ...branch } as never).baseline).toBeNull();
  });

  it('inherits a baseline with copy ids remapped onto the new copies, keeping a deleted copy’s id', () => {
    const source = fork([row('a', 'h1'), row('b', 'h2')]);
    if (!source) throw new Error('expected a baseline');
    const remap = new Map([['copy-a', 'grandcopy-a']]); // the source deleted copy-b
    const inherited = inheritForkBaseline(source, (id) => remap.get(id)) as { pages: Record<string, { copyId: string; hash: string }> };
    expect(inherited.pages.a).toMatchObject({ copyId: 'grandcopy-a', hash: 'h1' });
    expect(inherited.pages.b).toMatchObject({ copyId: 'copy-b', hash: 'h2' });
    // A value, not a reference: the source is unchanged.
    expect(source.pages.a?.copyId).toBe('copy-a');
  });
});

describe('changedOnMainSinceFork', () => {
  const baseline = fork([
    row('guide', 'g', { kind: 'GROUP' }),
    row('billing', 'b', { parentId: 'guide', path: 'guide/billing' }),
    row('legacy', 'l', { languageId: 'lang-ar' }),
  ]);
  if (!baseline) throw new Error('expected a baseline');

  it('lists nothing when hashes and parents match, even after a drag (position) or a touch (updatedAt)', () => {
    const main = [
      row('guide', 'g', { position: 9, updatedAt: LATER }),
      row('billing', 'b', { parentId: 'guide', path: 'guide/billing' }),
      row('legacy', 'l'),
    ];
    expect(changedOnMainSinceFork(main, baseline, codes)).toEqual([]);
  });

  it('lists modified (content or parent), added and deleted pages, sorted by path', () => {
    const main = [
      row('guide', 'g2', { updatedAt: LATER }),
      row('billing', 'b', { parentId: null, path: 'billing', updatedAt: LATER }),
      row('refunds', 'r', { updatedAt: LATER }),
    ];
    expect(changedOnMainSinceFork(main, baseline, codes)).toEqual([
      { pageId: 'billing', title: 'BILLING', path: 'billing', languageCode: 'en', change: 'modified', updatedAt: LATER.toISOString() },
      { pageId: 'guide', title: 'GUIDE', path: 'guide', languageCode: 'en', change: 'modified', updatedAt: LATER.toISOString() },
      { pageId: 'legacy', title: 'LEGACY', path: 'legacy', languageCode: 'ar', change: 'deleted', updatedAt: FORKED.toISOString() },
      { pageId: 'refunds', title: 'REFUNDS', path: 'refunds', languageCode: 'en', change: 'added', updatedAt: LATER.toISOString() },
    ]);
  });

  it('does not treat a page id named like an Object prototype key as known', () => {
    const empty = fork([]);
    if (!empty) throw new Error('expected a baseline');
    expect(changedOnMainSinceFork([row('constructor', 'x')], empty, codes).map((p) => p.change)).toEqual(['added']);
  });
});

describe('getMergePreview', () => {
  const withFork = (forkBaseline: unknown, forkedAt: Date | null = FORKED) =>
    db.branch.findFirst.mockImplementation(async ({ where, select }) =>
      select ? { createdAt: CREATED, forkedAt, forkBaseline } : { id: where.id, isDefault: false },
    );

  it('compares main pages with the baseline hashes and parents', async () => {
    withFork(stored([row('a', 'h1')]));
    pageRows = [row('a', 'h2')];
    await expect(getMergePreview('project', 'v2')).resolves.toEqual({
      changedOnMainSinceFork: [expect.objectContaining({ pageId: 'a', change: 'modified' })],
      baselineComplete: true,
    });
    expect(statements[0]).toContain('"parentId"');
    expect(statements[0]).toContain('md5(json_build_array(');
  });

  it('reports an incomplete comparison without a baseline', async () => {
    withFork(null, null);
    await expect(getMergePreview('project', 'v2')).resolves.toEqual({ changedOnMainSinceFork: [], baselineComplete: false });
  });
});

describe('mergeBranch', () => {
  const forkOf = (pages: Row[]) => ({ createdAt: CREATED, forkedAt: FORKED, forkBaseline: stored(pages) });

  it('locks the project, then the version, then both branches’ pages in id order, before comparing', async () => {
    versionRow = forkOf([row('a', 'h1')]);
    pageRows = [{ ...row('a', 'h1'), branchId: 'main' }];
    await mergeBranch('project', 'v2');
    expect(statements).toHaveLength(5);
    expect(statements[0]).toBe('SELECT 1 FROM "project" WHERE "id" = ? FOR NO KEY UPDATE');
    expect(statements[1]).toMatch(/FROM "branch" WHERE "id" = \? .* FOR UPDATE$/);
    expect(statements[2]).toMatch(/FROM "page" WHERE .* "branchId" IN \(\?, \?\) ORDER BY "id" ASC FOR NO KEY UPDATE$/);
    expect(statements[2]).toContain('md5(json_build_array(');
    expect(statements[2]).toContain('"parentId"');
    // Then the main pages it deletes are upgraded, in id order, and main is re-checked.
    expect(statements[3]).toBe('SELECT "id" FROM "page" WHERE "projectId" = ? AND "id" = ANY(?::text[]) ORDER BY "id" ASC FOR UPDATE');
    expect(statements[4]).toMatch(/FROM "page" WHERE "projectId" = \? AND "branchId" = \? AND NOT \("id" = ANY\(\?::text\[\]\)\)$/);
    expect(db.$queryRaw.mock.calls[3]?.[0].values).toEqual(['project', ['a']]);
    expect(db.page.deleteMany.mock.invocationCallOrder[0]).toBeGreaterThan(db.$queryRaw.mock.invocationCallOrder[4] ?? Number.POSITIVE_INFINITY);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
  });

  it('keeps today’s promote when main is unchanged: replace main’s pages, move the version’s, drop the version', async () => {
    versionRow = forkOf([row('a', 'h1')]);
    pageRows = [
      { ...row('a', 'h1', { position: 5, updatedAt: LATER }), branchId: 'main' },
      { ...row('copy-a', 'ignored'), branchId: 'v2' },
    ];
    await expect(mergeBranch('project', 'v2')).resolves.toMatchObject({ id: 'main' });
    // Only the locked main ids are deleted, never "everything on main".
    expect(db.page.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'project', id: { in: ['a'] } } });
    expect(db.page.updateMany).toHaveBeenCalledWith({ where: { projectId: 'project', branchId: 'v2' }, data: { branchId: 'main' } });
    expect(db.branch.delete).toHaveBeenCalledWith({ where: { id: 'v2' }, select: { id: true } });
    expect(db.page.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(db.page.updateMany.mock.invocationCallOrder[0] ?? 0);
    // Main's page ids changed: every other version's baseline is forgotten, in the same transaction.
    expect(db.branch.updateMany).toHaveBeenCalledWith({
      where: { projectId: 'project', isDefault: false, id: { not: 'v2' } },
      data: { forkedAt: null, forkBaseline: DbNull },
    });
    expect(db.branch.updateMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      db.page.updateMany.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('refuses with branch:main_changed and the changed pages, changing nothing', async () => {
    versionRow = forkOf([row('a', 'h1'), row('gone', 'g')]);
    pageRows = [{ ...row('a', 'h2', { updatedAt: LATER }), branchId: 'main' }];
    const error = await mergeBranch('project', 'v2').catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 409,
      code: 'branch:main_changed',
      details: {
        reason: 'main_changed',
        changedOnMainSinceFork: [
          expect.objectContaining({ pageId: 'a', change: 'modified' }),
          expect.objectContaining({ pageId: 'gone', change: 'deleted' }),
        ],
      },
    });
    expect(db.page.deleteMany).not.toHaveBeenCalled();
    expect(db.page.updateMany).not.toHaveBeenCalled();
    expect(db.branch.delete).not.toHaveBeenCalled();
    expect(db.branch.updateMany).not.toHaveBeenCalled();
  });

  it('refuses, listing it as added, when a main page appeared after the locked read', async () => {
    versionRow = forkOf([row('a', 'h1')]);
    pageRows = [{ ...row('a', 'h1'), branchId: 'main' }];
    appearedRows = [row('new-child', 'x', { parentId: 'a', path: 'a/new-child', updatedAt: LATER })];
    await expect(mergeBranch('project', 'v2')).rejects.toMatchObject({
      status: 409,
      code: 'branch:main_changed',
      details: {
        reason: 'main_changed',
        changedOnMainSinceFork: [
          { pageId: 'new-child', title: 'NEW-CHILD', path: 'a/new-child', languageCode: 'en', change: 'added', updatedAt: LATER.toISOString() },
        ],
      },
    });
    expect(db.page.deleteMany).not.toHaveBeenCalled();
    expect(db.page.updateMany).not.toHaveBeenCalled();
    expect(db.branch.delete).not.toHaveBeenCalled();
    expect(db.branch.updateMany).not.toHaveBeenCalled();
  });

  it('deletes more than one chunk of main pages by id, without comparing counts', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => row(`p${String(i).padStart(4, '0')}`, 'h'));
    versionRow = forkOf(many);
    pageRows = many.map((p) => ({ ...p, branchId: 'main' }));
    db.page.deleteMany.mockResolvedValue({ count: 0 }); // cascades may have removed them already
    await mergeBranch('project', 'v2');
    const chunks = db.page.deleteMany.mock.calls.map((c) => c[0].where.id.in as string[]);
    expect(chunks.map((c) => c.length)).toEqual([1000, 1000, 500]);
    expect(chunks.flat()).toEqual(many.map((p) => p.id));
    expect(db.branch.delete).toHaveBeenCalled();
  });

  it('refuses with branch:baseline_missing and a hint counted after the locks', async () => {
    versionRow = { createdAt: CREATED, forkedAt: null, forkBaseline: null };
    pageRows = [{ ...row('a', 'h1'), branchId: 'main' }];
    db.page.count.mockResolvedValue(3);
    const error = await mergeBranch('project', 'v2').catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 409,
      code: 'branch:baseline_missing',
      details: { since: CREATED.toISOString(), mainPagesEditedOrCreatedSince: 3 },
    });
    expect(db.page.count).toHaveBeenCalledWith({
      where: { projectId: 'project', branchId: 'main', OR: [{ updatedAt: { gt: CREATED } }, { createdAt: { gt: CREATED } }] },
    });
    expect(statements).toHaveLength(3);
    expect(db.page.count.mock.invocationCallOrder[0]).toBeGreaterThan(db.$queryRaw.mock.invocationCallOrder[2] ?? Number.POSITIVE_INFINITY);
    expect(db.page.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses even when nothing changed, if the version has a fork time but no baseline, counting from the fork time', async () => {
    versionRow = { createdAt: CREATED, forkedAt: FORKED, forkBaseline: null };
    pageRows = [];
    await expect(mergeBranch('project', 'v2')).rejects.toMatchObject({ code: 'branch:baseline_missing', details: { since: FORKED.toISOString() } });
    expect(db.page.count).toHaveBeenCalledWith({
      where: { projectId: 'project', branchId: 'main', OR: [{ updatedAt: { gt: FORKED } }, { createdAt: { gt: FORKED } }] },
    });
    expect(db.page.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects the default branch before taking any lock', async () => {
    await expect(mergeBranch('project', 'main')).rejects.toMatchObject({ status: 409, code: 'database:conflict' });
    expect(statements).toEqual([]);
  });
});

describe('createBranch', () => {
  const sourceRow = (id: string, hash: string) => ({
    ...row(id, hash),
    icon: null,
    description: null,
    content: '',
    config: null,
    translationKey: null,
    hidden: false,
  });
  beforeEach(() => {
    db.branch.create.mockImplementation(async ({ data }) => ({ id: 'new', ...data }));
  });

  it('records main’s pages, hashed in the statement that reads them, after the project lock', async () => {
    pageRows = [sourceRow('a', 'h1') as never];
    await createBranch('project', { name: 'v2' });
    expect(statements[0]).toBe('SELECT 1 FROM "project" WHERE "id" = ? FOR NO KEY UPDATE');
    expect(statements[1]).toMatch(/^SELECT "id", .*md5\(json_build_array\(.*\) AS "hash" FROM "page" WHERE .* "branchId" = \?/);
    expect(db.branch.create.mock.calls[0]?.[0].data.forkedAt).toBeInstanceOf(Date);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
    const copyId = db.page.createMany.mock.calls[0]?.[0].data[0].id;
    const baseline = db.branch.update.mock.calls[0]?.[0].data.forkBaseline;
    expect(baseline).toMatchObject({ version: 2, pages: { a: { copyId, hash: 'h1', parentId: null, kind: 'PAGE' } } });
  });

  it('copies the source version’s fork time and baseline, remapped onto its own copies', async () => {
    const source = { id: 'v2', isDefault: false, createdAt: CREATED, forkedAt: FORKED };
    db.branch.findFirst.mockImplementation(async ({ where }) => (where.name ? null : source));
    db.branch.findUniqueOrThrow.mockResolvedValue({ createdAt: CREATED, forkedAt: FORKED, forkBaseline: stored([row('a', 'h1')]) });
    pageRows = [sourceRow('copy-a', 'h1') as never];
    await createBranch('project', { name: 'v3', fromBranchId: 'v2' });
    expect(db.branch.create.mock.calls[0]?.[0].data.forkedAt).toBe(FORKED);
    const newCopyId = db.page.createMany.mock.calls[0]?.[0].data[0].id;
    expect(newCopyId).not.toBe('copy-a');
    expect(db.branch.update.mock.calls[0]?.[0].data.forkBaseline).toMatchObject({ version: 2, pages: { a: { copyId: newCopyId, hash: 'h1' } } });
    // The source's baseline is read under the project lock.
    expect(db.branch.findUniqueOrThrow.mock.invocationCallOrder[0]).toBeGreaterThan(
      db.$queryRaw.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('gives a copy of a version without a baseline no baseline either', async () => {
    const source = { id: 'v2', isDefault: false, createdAt: CREATED, forkedAt: null };
    db.branch.findFirst.mockImplementation(async ({ where }) => (where.name ? null : source));
    db.branch.findUniqueOrThrow.mockResolvedValue({ createdAt: CREATED, forkedAt: null, forkBaseline: null });
    pageRows = [];
    await createBranch('project', { name: 'v3', fromBranchId: 'v2' });
    expect(db.branch.update).not.toHaveBeenCalled();
  });
});
