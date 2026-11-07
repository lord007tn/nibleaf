import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string; branchId: string };

const state = vi.hoisted(() => ({ pages: [] as Row[], branch: {} as Record<string, unknown>, sql: [] as string[] }));
const db = vi.hoisted(() => ({
  branch: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
  page: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
  language: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));
const recompute = vi.hoisted(() => vi.fn());
vi.mock('@nibleaf/database', () => ({
  prisma: db,
  Prisma: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join('?'), values }) },
}));
vi.mock('./pages', () => ({ recomputeProjectPaths: recompute }));

import { createBranch, getMergePreview, mergeBranch } from './branches';

const FORK = new Date('2026-11-01T10:00:00.000Z');
const AFTER = new Date('2026-11-02T10:00:00.000Z');
const page = (id: string, branchId: string, overrides: Partial<Row> = {}): Row => ({
  id,
  branchId,
  parentId: null,
  kind: 'PAGE',
  title: id,
  path: id,
  languageId: 'lang-en',
  createdAt: FORK,
  updatedAt: FORK,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  state.sql = [];
  db.branch.findMany.mockResolvedValue([{ id: 'main', isDefault: true, createdAt: FORK, forkedAt: null }]);
  db.branch.findFirst.mockImplementation(async ({ where }) => (where.id === 'v2' ? state.branch : null));
  db.branch.create.mockImplementation(async ({ data }) => ({ id: 'v2', ...data }));
  db.page.findMany.mockImplementation(async ({ where }) => state.pages.filter((p) => p.branchId === where.branchId));
  db.language.findMany.mockResolvedValue([{ id: 'lang-en', code: 'en' }]);
  db.$queryRaw.mockImplementation(async (query: { text: string }) => {
    state.sql.push(query.text);
    return query.text.includes('"branch"') ? [{ id: 'v2' }] : [];
  });
  db.$transaction.mockImplementation(async (fn) => fn(db));
});

/** Fork main (pages `billing`, `intro`) through createBranch, so the baseline
 *  and the copies come from the real fork code. */
const forkMain = async () => {
  vi.useFakeTimers({ now: FORK, toFake: ['Date'] });
  state.pages = [page('billing', 'main', { updatedAt: new Date('2026-10-01T00:00:00.000Z') }), page('intro', 'main')];
  await createBranch('project', { name: 'v2' });
  vi.useRealTimers();
  const created = db.branch.create.mock.calls[0]?.[0].data;
  const copies = db.page.createMany.mock.calls[0]?.[0].data as Row[];
  state.branch = { id: 'v2', projectId: 'project', isDefault: false, createdAt: FORK, ...created };
  state.pages.push(...copies.map((c) => page(c.id, 'v2', { title: c.title as string, path: c.path as string, updatedAt: c.updatedAt as Date })));
  return copies;
};

describe('createBranch', () => {
  it('records the fork time and a baseline of main, and stamps copies with the fork time', async () => {
    const copies = await forkMain();
    const data = db.branch.create.mock.calls[0]?.[0].data;
    expect(data.forkedAt).toEqual(FORK);
    expect(data.forkBaseline).toMatchObject({
      version: 1,
      pages: { billing: { copyId: copies[0]?.id, updatedAt: '2026-10-01T00:00:00.000Z', title: 'billing', path: 'billing', kind: 'PAGE' } },
    });
    expect(copies.every((c) => (c.updatedAt as Date).getTime() === FORK.getTime())).toBe(true);
  });
});

describe('mergeBranch', () => {
  it('promotes with no flag when main is unchanged', async () => {
    await forkMain();
    await mergeBranch('project', 'v2');
    expect(db.page.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'project', branchId: 'main', id: { in: ['billing', 'intro'] } } });
    expect(db.page.updateMany).toHaveBeenCalledWith({ where: { projectId: 'project', branchId: 'v2' }, data: { branchId: 'main' } });
    expect(db.branch.delete).toHaveBeenCalledWith({ where: { id: 'v2' } });
  });

  it('locks the project, then the version, then main pages, before reading', async () => {
    await forkMain();
    await mergeBranch('project', 'v2');
    expect(state.sql.map((s) => s.match(/FROM "(\w+)"/)?.[1])).toEqual(['project', 'branch', 'page']);
    expect(state.sql.every((s) => s.includes('FOR UPDATE'))).toBe(true);
    expect(db.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(db.page.findMany.mock.invocationCallOrder.at(-2) ?? 0);
  });

  it('refuses an unconfirmed promote after an edit on main, listing it, and changes nothing', async () => {
    await forkMain();
    const billing = state.pages.find((p) => p.id === 'billing');
    if (billing) Object.assign(billing, { title: 'Billing (typo fixed)', updatedAt: AFTER });

    const expected = {
      baselineComplete: true,
      changedOnMainSinceFork: [
        { pageId: 'billing', title: 'Billing (typo fixed)', path: 'billing', languageCode: 'en', change: 'modified', updatedAt: AFTER.toISOString() },
      ],
    };
    await expect(getMergePreview('project', 'v2')).resolves.toEqual(expected);
    const refused = await mergeBranch('project', 'v2', {}).catch((error: unknown) => error);
    expect(refused).toMatchObject({
      status: 409,
      code: 'branch:main_changed',
      message: 'Pages on main changed since this version was created. Review them before promoting.',
      details: expected,
    });
    expect(db.page.deleteMany).not.toHaveBeenCalled();
    expect(db.page.updateMany).not.toHaveBeenCalled();
    expect(db.branch.delete).not.toHaveBeenCalled();

    // Confirmed: the version's copy replaces main's edited page.
    await mergeBranch('project', 'v2', { confirmChangedOnMain: true });
    expect(db.page.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'project', branchId: 'main', id: { in: ['billing', 'intro'] } } });
    expect(db.page.updateMany).toHaveBeenCalledOnce();
  });

  it('keeps a page added on main after a confirmed promote', async () => {
    await forkMain();
    state.pages.push(page('refunds', 'main', { createdAt: AFTER, updatedAt: AFTER }));
    await expect(mergeBranch('project', 'v2')).rejects.toMatchObject({
      details: { changedOnMainSinceFork: [expect.objectContaining({ pageId: 'refunds', change: 'added' })] },
    });
    await mergeBranch('project', 'v2', { confirmChangedOnMain: true });
    const deleted = db.page.deleteMany.mock.calls.flatMap(([args]) => args.where.id.in as string[]);
    expect(deleted).not.toContain('refunds');
  });

  it('does not bring back an unedited page deleted on main', async () => {
    const copies = await forkMain();
    state.pages = state.pages.filter((p) => p.id !== 'intro');
    await expect(getMergePreview('project', 'v2')).resolves.toMatchObject({
      changedOnMainSinceFork: [{ pageId: 'intro', change: 'deleted' }],
    });
    await mergeBranch('project', 'v2', { confirmChangedOnMain: true });
    expect(db.page.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'project', branchId: 'v2', id: { in: [copies[1]?.id] } } });
  });

  it('compares a legacy version from its createdAt without a baseline', async () => {
    state.branch = { id: 'v2', projectId: 'project', isDefault: false, createdAt: FORK, forkedAt: null, forkBaseline: null };
    state.pages = [
      page('billing', 'main', { updatedAt: AFTER }),
      page('refunds', 'main', { createdAt: AFTER, updatedAt: AFTER }),
      page('v-billing', 'v2'),
    ];
    await expect(getMergePreview('project', 'v2')).resolves.toEqual({
      baselineComplete: false,
      changedOnMainSinceFork: [
        expect.objectContaining({ pageId: 'billing', change: 'modified' }),
        expect.objectContaining({ pageId: 'refunds', change: 'added' }),
      ],
    });
    await mergeBranch('project', 'v2', { confirmChangedOnMain: true });
    expect(db.page.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'project', branchId: 'main', id: { in: ['billing'] } } });
  });

  it('answers not found when the version disappears before the lock', async () => {
    await forkMain();
    db.$queryRaw.mockImplementation(async () => []);
    await expect(mergeBranch('project', 'v2')).rejects.toMatchObject({ status: 404 });
  });
});
