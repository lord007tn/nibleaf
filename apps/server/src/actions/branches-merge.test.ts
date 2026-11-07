import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: string;
  branchId: string;
  parentId: string | null;
  kind: string;
  title: string;
  slug: string;
  path: string;
  languageId: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  hash: string;
};

const state = vi.hoisted(() => ({ rows: [] as Row[], branch: {} as Record<string, unknown>, sql: [] as string[] }));
const db = vi.hoisted(() => ({
  branch: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  page: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  comment: { groupBy: vi.fn(), updateMany: vi.fn() },
  language: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));
const recompute = vi.hoisted(() => vi.fn());
vi.mock('@nibleaf/database', () => {
  type Fragment = { text: string };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]): Fragment => ({
    text: strings.reduce((out, part, i) => out + part + (i < values.length ? ((values[i] as Fragment | undefined)?.text ?? '?') : ''), ''),
  });
  return { prisma: db, Prisma: { sql, empty: { text: '' }, DbNull: 'DbNull' } };
});
vi.mock('./pages', () => ({ recomputeProjectPaths: recompute }));

import { createBranch, getMergePreview, mergeBranch } from './branches';

const FORK = new Date('2026-11-01T10:00:00.000Z');
const AFTER = new Date('2026-11-02T10:00:00.000Z');
const row = (id: string, branchId: string, overrides: Partial<Row> = {}): Row => ({
  id,
  branchId,
  parentId: null,
  kind: 'PAGE',
  title: id,
  slug: id,
  path: id,
  languageId: 'lang-en',
  position: 0,
  createdAt: FORK,
  updatedAt: FORK,
  hash: `h:${id}`,
  ...overrides,
});
const find = (id: string) => {
  const found = state.rows.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};

beforeEach(() => {
  vi.resetAllMocks();
  state.sql = [];
  db.branch.findMany.mockResolvedValue([{ id: 'main', isDefault: true, createdAt: FORK, forkedAt: null }]);
  db.branch.findFirst.mockImplementation(async ({ where }) => (where.id === 'v2' ? state.branch : null));
  db.branch.create.mockImplementation(async ({ data }) => ({ id: 'v2', ...data }));
  db.page.findMany.mockImplementation(async ({ where }) => state.rows.filter((r) => where.id.in.includes(r.id)));
  db.page.updateMany.mockResolvedValue({ count: 1 });
  db.page.deleteMany.mockImplementation(async ({ where }) => ({ count: where.OR.length }));
  db.page.count.mockResolvedValue(0);
  db.comment.groupBy.mockResolvedValue([]);
  db.language.findMany.mockResolvedValue([{ id: 'lang-en', code: 'en' }]);
  db.$queryRaw.mockImplementation(async (query: { text: string }) => {
    state.sql.push(query.text);
    if (query.text.includes('FROM "branch"')) return [{ id: 'v2' }];
    if (query.text.includes('"position"')) return state.rows;
    if (query.text.includes('AS "hash"')) return state.rows.map((r) => ({ id: r.id, hash: r.hash }));
    return [];
  });
  db.$transaction.mockImplementation(async (fn) => fn(db));
});

/** Fork main (`billing`, `intro`) through createBranch, so the baseline comes
 *  from the real fork code. Returns main id → copy id. */
const forkMain = async () => {
  state.rows = [row('billing', 'main'), row('intro', 'main')];
  db.page.findMany.mockResolvedValueOnce([...state.rows]);
  db.page.createMany.mockImplementationOnce(async ({ data }: { data: Row[] }) => {
    for (const c of data) state.rows.push(row(c.id, 'v2', { title: c.title, slug: c.slug, path: c.path, hash: `h:${c.title}` }));
  });
  await createBranch('project', { name: 'v2' });
  const created = db.branch.create.mock.calls[0]?.[0].data;
  const forkBaseline = db.branch.update.mock.calls[0]?.[0].data.forkBaseline as { pages: Record<string, { copyId: string }> };
  state.branch = { id: 'v2', projectId: 'project', isDefault: false, createdAt: FORK, ...created, forkBaseline };
  state.sql = [];
  return (mainId: string) => forkBaseline.pages[mainId]?.copyId as string;
};

describe('createBranch', () => {
  it('takes the project lock first, then records a baseline hashed with the promote SQL', async () => {
    const copyOf = await forkMain();
    expect(db.$queryRaw.mock.calls[0]?.[0].text).toBe('SELECT 1 FROM "project" WHERE "id" = ? FOR NO KEY UPDATE');
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.page.findMany.mock.invocationCallOrder[0] ?? 0);
    expect(db.branch.update.mock.calls[0]?.[0].data.forkBaseline).toMatchObject({
      version: 2,
      pages: { billing: { copyId: copyOf('billing'), hash: 'h:billing', copyHash: 'h:billing', parentId: null, position: 0 } },
    });
  });
});

describe('mergeBranch', () => {
  it('locks project, version, then both branches’ pages in one ascending pass, all FOR NO KEY UPDATE', async () => {
    await forkMain();
    await mergeBranch('project', 'v2');
    expect(state.sql.map((s) => s.match(/FROM "(\w+)"/)?.[1])).toEqual(['project', 'branch', 'page']);
    expect(state.sql.every((s) => s.trimEnd().endsWith('FOR NO KEY UPDATE'))).toBe(true);
    expect(state.sql.some((s) => /FOR UPDATE/.test(s))).toBe(false);
    expect(state.sql[2]).toMatch(/"branchId" IN \(\?, \?\)\s+ORDER BY "id" ASC FOR NO KEY UPDATE/);
  });

  it('promotes an untouched main without a flag: folds the copies, writes no page content', async () => {
    const copyOf = await forkMain();
    await mergeBranch('project', 'v2');
    expect(db.page.updateMany).not.toHaveBeenCalled();
    expect(db.page.deleteMany).toHaveBeenCalledWith({
      where: {
        projectId: 'project',
        branchId: 'v2',
        OR: [
          { id: copyOf('billing'), updatedAt: FORK },
          { id: copyOf('intro'), updatedAt: FORK },
        ],
      },
    });
    expect(db.branch.delete).toHaveBeenCalledWith({ where: { id: 'v2' } });
    expect(recompute).toHaveBeenCalledWith('project', db);
  });

  it('refuses an unconfirmed promote after an edit on main, listing it, and changes nothing', async () => {
    await forkMain();
    Object.assign(find('billing'), { title: 'Billing (typo fixed)', hash: 'h:fixed', updatedAt: AFTER });
    await expect(mergeBranch('project', 'v2', {})).rejects.toMatchObject({
      status: 409,
      code: 'branch:main_changed',
      message: 'Pages on main changed since this version was created. Review them before promoting.',
      details: {
        baselineComplete: true,
        changedOnMainSinceFork: [
          {
            pageId: 'billing',
            title: 'Billing (typo fixed)',
            path: 'billing',
            languageCode: 'en',
            change: 'modified',
            onPromote: 'kept',
            updatedAt: AFTER.toISOString(),
          },
        ],
      },
    });
    expect(db.page.deleteMany).not.toHaveBeenCalled();
    expect(db.branch.delete).not.toHaveBeenCalled();
  });

  it('writes the version’s edit into the main row in place on a confirmed promote', async () => {
    const copyOf = await forkMain();
    Object.assign(find('billing'), { hash: 'h:main-edit', updatedAt: AFTER });
    Object.assign(find(copyOf('billing')), { title: 'Billing v2', hash: 'h:version-edit', updatedAt: AFTER });
    await mergeBranch('project', 'v2', { confirmChangedOnMain: true });
    expect(db.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'billing', updatedAt: AFTER, projectId: 'project', branchId: 'main' },
      data: expect.objectContaining({ title: 'Billing v2' }),
    });
  });

  it('rolls back with a retryable conflict when a row changed after the locked read', async () => {
    const copyOf = await forkMain();
    Object.assign(find(copyOf('billing')), { hash: 'h:version-edit', updatedAt: AFTER });
    db.page.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(mergeBranch('project', 'v2')).rejects.toMatchObject({
      status: 409,
      code: 'database:conflict',
      details: { reason: 'promote_raced' },
    });
    expect(db.branch.delete).not.toHaveBeenCalled();
  });

  it('refuses to delete a version page it never read', async () => {
    await forkMain();
    db.page.count.mockResolvedValueOnce(1);
    await expect(mergeBranch('project', 'v2')).rejects.toMatchObject({ details: { reason: 'promote_raced' } });
    expect(db.branch.delete).not.toHaveBeenCalled();
  });

  it('answers not found when the version disappears before the lock', async () => {
    await forkMain();
    db.$queryRaw.mockImplementation(async () => []);
    await expect(mergeBranch('project', 'v2')).rejects.toMatchObject({ status: 404 });
  });
});

describe('getMergePreview', () => {
  it('is a plain read: no transaction, no locks', async () => {
    await forkMain();
    db.$transaction.mockClear();
    await expect(getMergePreview('project', 'v2')).resolves.toEqual({ changedOnMainSinceFork: [], baselineComplete: true });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(state.sql.some((s) => s.includes('FOR NO KEY UPDATE'))).toBe(false);
  });
});
