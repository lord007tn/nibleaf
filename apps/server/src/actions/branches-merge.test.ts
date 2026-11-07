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
  branch: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
  page: { deleteMany: vi.fn(), updateMany: vi.fn(), createMany: vi.fn(), count: vi.fn() },
  language: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock('@nibleaf/database', () => ({ prisma: db, Prisma: { sql, DbNull } }));

import { buildForkBaseline, changedOnMainSinceFork, type HashedPageRow, pageContentHash, parseForkBaseline } from './branch-fork';
import { createBranch, getMergePreview, mergeBranch } from './branches';

const FORKED = new Date('2026-11-01T10:00:00.000Z');
const LATER = new Date('2026-11-02T10:00:00.000Z');
const page = (id: string, hash: string, extra: Partial<HashedPageRow> = {}): HashedPageRow => ({
  id,
  title: id.toUpperCase(),
  path: id,
  languageId: 'lang-en',
  updatedAt: FORKED,
  hash,
  ...extra,
});
const baselineOf = (pages: HashedPageRow[]) => buildForkBaseline(pages);
const codes = new Map([
  ['lang-en', 'en'],
  ['lang-ar', 'ar'],
]);

/** Every raw statement, in order, so tests can check the lock order. */
const statements: string[] = [];
let versionRow: { createdAt: Date; forkedAt: Date | null; forkBaseline: unknown } | undefined;
let pageRows: Array<HashedPageRow & { branchId: string }> = [];

beforeEach(() => {
  vi.resetAllMocks();
  statements.length = 0;
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.branch.findMany.mockResolvedValue([{ id: 'main', isDefault: true }]);
  db.branch.findFirst.mockImplementation(async ({ where }) => (where.name ? null : { id: where.id, isDefault: where.id === 'main' }));
  db.language.findMany.mockResolvedValue([...codes].map(([id, code]) => ({ id, code })));
  db.page.count.mockResolvedValue(0);
  db.$queryRaw.mockImplementation(async (query: Sql) => {
    statements.push(query.text.replace(/\s+/g, ' ').trim());
    if (query.text.includes('FROM "branch"')) return versionRow ? [versionRow] : [];
    if (query.text.includes('FROM "page"')) return pageRows;
    return [];
  });
});

describe('pageContentHash', () => {
  it('hashes a JSON tuple of exactly the content fields, in a fixed order, without position', () => {
    const { text } = pageContentHash() as unknown as Sql;
    // Stored baselines depend on this exact expression: changing it makes every
    // open version look changed.
    expect(text).toBe(
      'md5(jsonb_build_array("title", "slug", "kind"::text, "content", "description", "icon", "config", "translationKey", "hidden", "parentId")::text)',
    );
    expect(text).not.toContain('position');
    expect(text).not.toContain('concat');
  });
});

describe('fork baselines', () => {
  it('records each main page with its hash and what the preview needs', () => {
    expect(baselineOf([page('a', 'h1', { updatedAt: LATER })])).toEqual({
      version: 1,
      pages: { a: { hash: 'h1', title: 'A', path: 'a', languageId: 'lang-en', updatedAt: LATER.toISOString() } },
    });
  });

  it.each([
    ['no fork time', { forkedAt: null, forkBaseline: { version: 1, pages: {} } }],
    ['no baseline', { forkedAt: FORKED, forkBaseline: null }],
    ['an unknown version', { forkedAt: FORKED, forkBaseline: { version: 2, pages: {} } }],
    ['a malformed entry', { forkedAt: FORKED, forkBaseline: { version: 1, pages: { a: { hash: 1 } } } }],
    ['an array', { forkedAt: FORKED, forkBaseline: [] }],
  ])('treats %s as no baseline', (_label, branch) => {
    expect(parseForkBaseline(branch as never)).toBeNull();
  });

  it('accepts a stored baseline', () => {
    const baseline = baselineOf([page('a', 'h1')]);
    expect(parseForkBaseline({ forkedAt: FORKED, forkBaseline: JSON.parse(JSON.stringify(baseline)) })).toEqual(baseline);
  });
});

describe('changedOnMainSinceFork', () => {
  const baseline = baselineOf([page('guide', 'g'), page('guide/billing', 'b'), page('legacy', 'l', { languageId: 'lang-ar' })]);

  it('lists nothing when every main page still has its fork hash', () => {
    expect(
      changedOnMainSinceFork([page('guide', 'g', { updatedAt: LATER }), page('guide/billing', 'b'), page('legacy', 'l')], baseline, codes),
    ).toEqual([]);
  });

  it('lists modified, added and deleted pages, sorted by path', () => {
    const main = [page('guide/billing', 'b2', { updatedAt: LATER }), page('guide', 'g'), page('refunds', 'r', { updatedAt: LATER })];
    expect(changedOnMainSinceFork(main, baseline, codes)).toEqual([
      {
        pageId: 'guide/billing',
        title: 'GUIDE/BILLING',
        path: 'guide/billing',
        languageCode: 'en',
        change: 'modified',
        updatedAt: LATER.toISOString(),
      },
      { pageId: 'legacy', title: 'LEGACY', path: 'legacy', languageCode: 'ar', change: 'deleted', updatedAt: FORKED.toISOString() },
      { pageId: 'refunds', title: 'REFUNDS', path: 'refunds', languageCode: 'en', change: 'added', updatedAt: LATER.toISOString() },
    ]);
  });

  it('does not treat a page id named like an Object prototype key as known', () => {
    expect(changedOnMainSinceFork([page('constructor', 'x')], baselineOf([]), codes).map((p) => p.change)).toEqual(['added']);
  });
});

describe('getMergePreview', () => {
  it('compares main pages with the baseline hashes', async () => {
    db.branch.findFirst.mockImplementation(async ({ where, select }) =>
      select ? { forkedAt: FORKED, forkBaseline: baselineOf([page('a', 'h1')]) } : { id: where.id, isDefault: false },
    );
    pageRows = [{ ...page('a', 'h2'), branchId: 'main' }];
    await expect(getMergePreview('project', 'v2')).resolves.toEqual({
      changedOnMainSinceFork: [expect.objectContaining({ pageId: 'a', change: 'modified' })],
      baselineComplete: true,
    });
    expect(statements[0]).toContain('md5(jsonb_build_array(');
  });

  it('reports an incomplete comparison without a baseline', async () => {
    db.branch.findFirst.mockImplementation(async ({ where, select }) =>
      select ? { forkedAt: null, forkBaseline: null } : { id: where.id, isDefault: false },
    );
    await expect(getMergePreview('project', 'v2')).resolves.toEqual({ changedOnMainSinceFork: [], baselineComplete: false });
  });
});

describe('mergeBranch', () => {
  const created = new Date('2026-10-31T09:00:00.000Z');
  const forkOf = (pages: HashedPageRow[]) => ({ createdAt: created, forkedAt: FORKED, forkBaseline: baselineOf(pages) });

  it('locks the project, then the version, then both branches’ pages in id order, before comparing', async () => {
    versionRow = forkOf([page('a', 'h1')]);
    pageRows = [{ ...page('a', 'h1'), branchId: 'main' }];
    await mergeBranch('project', 'v2');
    expect(statements).toHaveLength(3);
    expect(statements[0]).toBe('SELECT 1 FROM "project" WHERE "id" = ? FOR NO KEY UPDATE');
    expect(statements[1]).toMatch(/FROM "branch" WHERE "id" = \? .* FOR NO KEY UPDATE$/);
    expect(statements[2]).toMatch(/FROM "page" WHERE .* "branchId" IN \(\?, \?\) ORDER BY "id" ASC FOR NO KEY UPDATE$/);
    expect(statements[2]).toContain('md5(jsonb_build_array(');
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
  });

  it('keeps today’s promote when main is unchanged: replace main’s pages, move the version’s, drop the version', async () => {
    versionRow = forkOf([page('a', 'h1')]);
    pageRows = [
      { ...page('a', 'h1', { updatedAt: LATER }), branchId: 'main' },
      { ...page('copy', 'ignored'), branchId: 'v2' },
    ];
    await expect(mergeBranch('project', 'v2')).resolves.toMatchObject({ id: 'main' });
    expect(db.page.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'project', branchId: 'main' } });
    expect(db.page.updateMany).toHaveBeenCalledWith({ where: { projectId: 'project', branchId: 'v2' }, data: { branchId: 'main' } });
    expect(db.branch.delete).toHaveBeenCalledWith({ where: { id: 'v2' } });
    expect(db.page.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(db.page.updateMany.mock.invocationCallOrder[0] ?? 0);
  });

  it('refuses with branch:main_changed and the changed pages, changing nothing', async () => {
    versionRow = forkOf([page('a', 'h1'), page('gone', 'g')]);
    pageRows = [{ ...page('a', 'h2', { updatedAt: LATER }), branchId: 'main' }];
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
  });

  it('refuses with branch:baseline_missing and a hint counted after the locks', async () => {
    versionRow = { createdAt: created, forkedAt: null, forkBaseline: null };
    pageRows = [{ ...page('a', 'h1'), branchId: 'main' }];
    db.page.count.mockResolvedValue(3);
    const error = await mergeBranch('project', 'v2').catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 409,
      code: 'branch:baseline_missing',
      details: { since: created.toISOString(), mainPagesEditedOrCreatedSince: 3 },
    });
    expect(db.page.count).toHaveBeenCalledWith({
      where: { projectId: 'project', branchId: 'main', OR: [{ updatedAt: { gt: created } }, { createdAt: { gt: created } }] },
    });
    expect(statements).toHaveLength(3);
    expect(db.page.count.mock.invocationCallOrder[0]).toBeGreaterThan(db.$queryRaw.mock.invocationCallOrder[2] ?? Number.POSITIVE_INFINITY);
    expect(db.page.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses even when nothing changed, if the version has no baseline', async () => {
    versionRow = { createdAt: created, forkedAt: FORKED, forkBaseline: null };
    pageRows = [];
    await expect(mergeBranch('project', 'v2')).rejects.toMatchObject({ code: 'branch:baseline_missing' });
    expect(db.page.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects the default branch before taking any lock', async () => {
    await expect(mergeBranch('project', 'main')).rejects.toMatchObject({ status: 409, code: 'database:conflict' });
    expect(statements).toEqual([]);
  });
});

describe('createBranch', () => {
  const sourceRow = (id: string, hash: string) => ({
    ...page(id, hash),
    parentId: null,
    kind: 'PAGE',
    slug: id,
    icon: null,
    description: null,
    content: '',
    config: null,
    translationKey: null,
    position: 0,
    hidden: false,
  });
  beforeEach(() => {
    db.branch.create.mockImplementation(async ({ data }) => ({ id: 'new', ...data }));
  });

  it('records main’s pages, hashed in the statement that reads them, after the project lock', async () => {
    pageRows = [sourceRow('a', 'h1') as never];
    await createBranch('project', { name: 'v2' });
    expect(statements[0]).toBe('SELECT 1 FROM "project" WHERE "id" = ? FOR NO KEY UPDATE');
    expect(statements[1]).toMatch(/^SELECT "id", .*md5\(jsonb_build_array\(.*\) AS "hash" FROM "page" WHERE/);
    const data = db.branch.create.mock.calls[0]?.[0].data;
    expect(data.forkedAt).toBeInstanceOf(Date);
    expect(data.forkBaseline).toEqual(baselineOf([page('a', 'h1')]));
    expect(db.page.createMany.mock.calls[0]?.[0].data).toEqual([expect.objectContaining({ branchId: 'new', title: 'A', kind: 'PAGE' })]);
  });

  it('copies the source version’s fork time and baseline as values', async () => {
    const stored = { forkedAt: FORKED, forkBaseline: JSON.parse(JSON.stringify(baselineOf([page('a', 'h1')]))) };
    db.branch.findFirst.mockImplementation(async ({ where, select }) => {
      if (where.name) return null;
      return select ? stored : { id: where.id, isDefault: false };
    });
    pageRows = [];
    await createBranch('project', { name: 'v3', fromBranchId: 'v2' });
    const data = db.branch.create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({ forkedAt: FORKED, forkBaseline: stored.forkBaseline });
    // A value, not a pointer to the source: nothing names v2.
    expect(JSON.stringify(data.forkBaseline)).not.toContain('v2');
    // Read under the project lock, after it was taken.
    expect(db.branch.findFirst.mock.invocationCallOrder.at(-1)).toBeGreaterThan(db.$queryRaw.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
  });

  it('gives a copy of a version without a baseline no baseline either', async () => {
    db.branch.findFirst.mockImplementation(async ({ where, select }) => {
      if (where.name) return null;
      return select ? { forkedAt: null, forkBaseline: null } : { id: where.id, isDefault: false };
    });
    pageRows = [];
    await createBranch('project', { name: 'v3', fromBranchId: 'v2' });
    expect(db.branch.create.mock.calls[0]?.[0].data).toMatchObject({ forkedAt: null, forkBaseline: DbNull });
  });
});
