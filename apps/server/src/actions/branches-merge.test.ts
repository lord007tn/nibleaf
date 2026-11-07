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
  icon: string | null;
  description: string | null;
  hidden: boolean;
  translationKey: string | null;
  contentHash: string;
  configHash: string;
  content: string;
  config: null;
  hash: string;
};

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  branches: {} as Record<string, Record<string, unknown>>,
  sql: [] as string[],
}));
const db = vi.hoisted(() => ({
  branch: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  page: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  comment: { groupBy: vi.fn(), updateMany: vi.fn() },
  audienceGrant: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  pageGitImportSource: { findMany: vi.fn(), createMany: vi.fn() },
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
  const join = (values: unknown[]): Fragment => ({ text: values.map(() => '?').join(', ') });
  return { prisma: db, Prisma: { sql, join, empty: { text: '' }, DbNull: 'DbNull' } };
});
vi.mock('./pages', () => ({ recomputeProjectPaths: recompute }));

import { createBranch, getMergePreview, mergeBranch } from './branches';

const FORK = new Date('2026-11-01T10:00:00.000Z');
const AFTER = new Date('2026-11-02T10:00:00.000Z');
/** Stand-in for the SQL hash: any field change changes it. */
const rehash = (r: Row) =>
  Object.assign(r, {
    hash: JSON.stringify([r.kind, r.title, r.slug, r.icon, r.description, r.contentHash, r.configHash, r.translationKey, r.hidden]),
  });
const row = (id: string, branchId: string, overrides: Partial<Row> = {}): Row =>
  rehash({
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
    icon: null,
    description: null,
    hidden: false,
    translationKey: null,
    contentHash: `text:${id}`,
    configHash: 'cfg',
    content: `Text of ${id}`,
    config: null,
    hash: '',
    ...overrides,
  });
const find = (id: string) => {
  const found = state.rows.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};
const edit = (id: string, change: Partial<Row>) => rehash(Object.assign(find(id), change));

beforeEach(() => {
  vi.resetAllMocks();
  state.sql = [];
  state.branches = { main: { id: 'main', projectId: 'project', isDefault: true, createdAt: FORK, forkedAt: null, forkBaseline: null } };
  db.branch.findMany.mockResolvedValue([{ id: 'main', isDefault: true, createdAt: FORK, forkedAt: null }]);
  db.branch.findFirst.mockImplementation(async ({ where }) => state.branches[where.id] ?? null);
  db.branch.create.mockImplementation(async ({ data }) => ({ id: 'v2', ...data }));
  db.page.findMany.mockImplementation(async ({ where }) => {
    if (where.parentId) return state.rows.filter((r) => where.parentId.in.includes(r.parentId));
    if (where.id) return state.rows.filter((r) => where.id.in.includes(r.id));
    return state.rows.filter((r) => r.branchId === where.branchId);
  });
  db.page.updateMany.mockResolvedValue({ count: 1 });
  db.page.deleteMany.mockImplementation(async ({ where }) => ({ count: where.id.in.length }));
  db.page.count.mockResolvedValue(0);
  db.comment.groupBy.mockResolvedValue([]);
  db.audienceGrant.findMany.mockResolvedValue([]);
  db.pageGitImportSource.findMany.mockResolvedValue([]);
  db.language.findMany.mockResolvedValue([{ id: 'lang-en', code: 'en' }]);
  db.$queryRaw.mockImplementation(async (query: { text: string }) => {
    state.sql.push(query.text);
    if (query.text.includes('FROM "branch"')) return [{ id: 'v2' }];
    if (query.text.includes('"position"')) return state.rows.map((r) => ({ ...r }));
    if (query.text.includes('AS "hash"')) return state.rows.map((r) => ({ id: r.id, hash: r.hash, configHash: r.configHash }));
    return [];
  });
  db.$transaction.mockImplementation(async (fn) => fn(db));
});

/** Fork main (`billing`, `intro`) through createBranch, so the baseline comes
 *  from the real fork code. Returns main id → copy id. */
const forkMain = async () => {
  state.rows = [row('billing', 'main'), row('intro', 'main')];
  db.page.createMany.mockImplementationOnce(async ({ data }: { data: Row[] }) => {
    for (const c of data) state.rows.push(row(c.id, 'v2', { title: c.title, slug: c.slug, path: c.path, contentHash: `text:${c.title}` }));
  });
  await createBranch('project', { name: 'v2' });
  const created = db.branch.create.mock.calls[0]?.[0].data;
  const forkBaseline = db.branch.update.mock.calls[0]?.[0].data.forkBaseline as { pages: Record<string, { copyId: string }> };
  state.branches.v2 = { id: 'v2', projectId: 'project', isDefault: false, createdAt: FORK, ...created, forkBaseline };
  state.sql = [];
  return (mainId: string) => forkBaseline.pages[mainId]?.copyId as string;
};
/** The 409 a promote answers, or null when it went through. */
const attempt = (body?: Parameters<typeof mergeBranch>[2]) =>
  mergeBranch('project', 'v2', body).then(
    () => null,
    (error: { status?: number; code?: string; details?: { fingerprint?: string; reason?: string } }) => error,
  );

describe('createBranch', () => {
  it('takes the project lock first, then reads pages, hashes and per-field values in one statement', async () => {
    const copyOf = await forkMain();
    expect(db.$queryRaw.mock.calls[0]?.[0].text).toBe('SELECT 1 FROM "project" WHERE "id" = ? FOR NO KEY UPDATE');
    const read = db.$queryRaw.mock.calls[1]?.[0].text as string;
    expect(read).toMatch(/"content", "config".*md5\(coalesce\("content", ''\)\) AS "contentHash".*AS "hash"\s+FROM "page"/s);
    expect(db.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(db.page.createMany.mock.invocationCallOrder[0] ?? 0);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
    expect(db.branch.update.mock.calls[0]?.[0].data.forkBaseline).toMatchObject({
      version: 2,
      pages: {
        billing: {
          copyId: copyOf('billing'),
          parentId: null,
          position: 0,
          fields: { slug: 'billing', title: 'billing', hidden: false, contentHash: 'text:billing', configHash: 'cfg' },
        },
      },
    });
  });
});

describe('mergeBranch', () => {
  it('locks project, version, both branches’ pages, then the rows it deletes, in that order', async () => {
    await forkMain();
    await mergeBranch('project', 'v2');
    expect(state.sql.map((s) => s.match(/FROM "(\w+)"/)?.[1])).toEqual(['project', 'branch', 'page', 'page']);
    expect(state.sql[0]).toMatch(/FOR NO KEY UPDATE$/);
    expect(state.sql[1]).toMatch(/FROM "branch".*FOR UPDATE$/);
    expect(state.sql[2]).toMatch(/"branchId" IN \(\?, \?\)\s+ORDER BY "id" ASC FOR NO KEY UPDATE$/);
    expect(state.sql[3]).toMatch(/"id" IN \(\?, \?\) ORDER BY "id" ASC FOR UPDATE$/);
  });

  it('promotes an untouched main without confirmation: folds the copies, writes no page content', async () => {
    const copyOf = await forkMain();
    await mergeBranch('project', 'v2');
    expect(db.page.updateMany).not.toHaveBeenCalled();
    expect(db.page.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'project', id: { in: [copyOf('billing'), copyOf('intro')].sort() } } });
    expect(db.branch.delete).toHaveBeenCalledWith({ where: { id: 'v2' }, select: { id: true } });
    expect(recompute).toHaveBeenCalledWith('project', db);
  });

  it('refuses until the confirmation matches the preview computed under the locks', async () => {
    const copyOf = await forkMain();
    edit('billing', { title: 'Billing (typo fixed)', updatedAt: AFTER });
    edit(copyOf('billing'), { contentHash: 'version text', updatedAt: AFTER });
    const first = await attempt();
    expect(first).toMatchObject({ status: 409, code: 'branch:main_changed' });
    expect(first?.details?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Someone edits billing again between the dialog and the click: the old confirmation no longer fits.
    edit('billing', { contentHash: 'edited again', updatedAt: new Date(AFTER.getTime() + 1000) });
    const stale = await attempt({ confirmPreview: first?.details?.fingerprint });
    expect(stale).toMatchObject({ status: 409, code: 'branch:main_changed' });
    expect(stale?.details?.fingerprint).not.toBe(first?.details?.fingerprint);
    expect(db.page.deleteMany).not.toHaveBeenCalled();
    // The fresh preview's fingerprint goes through.
    await expect(attempt({ confirmPreview: stale?.details?.fingerprint })).resolves.toBeNull();
    expect(db.branch.delete).toHaveBeenCalled();
  });

  it('writes only the fields the version changed into the main row', async () => {
    const copyOf = await forkMain();
    edit('billing', { slug: 'plans', path: 'plans', updatedAt: AFTER });
    edit(copyOf('billing'), { title: 'Billing v2', updatedAt: AFTER });
    const { details } = (await attempt()) ?? {};
    await mergeBranch('project', 'v2', { confirmPreview: details?.fingerprint });
    expect(db.page.updateMany).toHaveBeenCalledWith({
      where: { id: 'billing', updatedAt: AFTER, projectId: 'project', branchId: 'main' },
      data: { title: 'Billing v2' },
    });
  });

  it('refuses a version without a baseline, like #334, with the same details', async () => {
    await forkMain();
    state.branches.v2 = { ...state.branches.v2, forkBaseline: null };
    db.page.count.mockResolvedValueOnce(3);
    await expect(attempt()).resolves.toMatchObject({
      status: 409,
      code: 'branch:baseline_missing',
      details: { since: (state.branches.v2 as { forkedAt: Date }).forkedAt.toISOString(), mainPagesEditedOrCreatedSince: 3 },
    });
    expect(db.page.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses when a main page created after the read takes an address the version brings in', async () => {
    await forkMain();
    state.rows.push(row('v-new', 'v2', { slug: 'refunds', path: 'refunds' }));
    db.page.findMany.mockImplementation(async ({ where }) =>
      where.branchId === 'main'
        ? [
            ...state.rows.filter((r) => r.branchId === 'main'),
            { id: 'late', languageId: 'lang-en', path: 'refunds', slug: 'refunds', parentId: null },
          ]
        : [],
    );
    await expect(attempt()).resolves.toMatchObject({ status: 409, details: { reason: 'promote_raced' } });
    expect(db.page.deleteMany).not.toHaveBeenCalled();
  });

  it("moves a consumed copy's reader grants to the main page, dropping duplicates", async () => {
    const copyOf = await forkMain();
    db.audienceGrant.findMany.mockResolvedValueOnce([
      { id: 'g1', audienceId: 'partners', pageId: copyOf('billing') },
      { id: 'g2', audienceId: 'staff', pageId: copyOf('intro') },
    ]);
    db.audienceGrant.findUnique.mockImplementation(async ({ where }) =>
      where.audienceId_scopeKey.audienceId === 'staff' ? { id: 'existing' } : null,
    );
    await mergeBranch('project', 'v2');
    expect(db.audienceGrant.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { pageId: 'billing', scopeKey: 'PAGE:billing' } });
    expect(db.audienceGrant.delete).toHaveBeenCalledWith({ where: { id: 'g2' } });
  });

  it('rolls back with a retryable conflict when a row changed after the locked read', async () => {
    const copyOf = await forkMain();
    edit(copyOf('billing'), { title: 'Edited', updatedAt: AFTER });
    db.page.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(attempt()).resolves.toMatchObject({ status: 409, code: 'database:conflict', details: { reason: 'promote_raced' } });
    expect(db.branch.delete).not.toHaveBeenCalled();
  });

  it('refuses to delete a version page it never read', async () => {
    await forkMain();
    db.page.count.mockImplementation(async ({ where }) => (where.branchId === 'v2' ? 1 : 0));
    await expect(attempt()).resolves.toMatchObject({ details: { reason: 'promote_raced' } });
    expect(db.branch.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['a serialization failure', { code: 'P2034' }],
    ['a deadlock', { code: 'P2010', meta: { code: '40P01' } }],
  ])('turns %s into a retryable promote_raced', async (_label, failure) => {
    await forkMain();
    db.$transaction.mockRejectedValueOnce(failure);
    await expect(attempt()).resolves.toMatchObject({ status: 409, code: 'database:conflict', details: { reason: 'promote_raced' } });
  });

  it('answers not found when the version disappears before the lock', async () => {
    await forkMain();
    db.$queryRaw.mockImplementation(async () => []);
    await expect(attempt()).resolves.toMatchObject({ status: 404 });
  });
});

describe('getMergePreview', () => {
  it('is a plain read: no transaction, no locks', async () => {
    await forkMain();
    db.$transaction.mockClear();
    await expect(getMergePreview('project', 'v2')).resolves.toMatchObject({ changedOnMainSinceFork: [], baselineComplete: true });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(state.sql.some((s) => s.includes('FOR NO KEY UPDATE'))).toBe(false);
  });
});
