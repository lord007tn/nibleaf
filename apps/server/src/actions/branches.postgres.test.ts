import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Importing the server actions (Prisma client, i18n catalogs) can take well
 *  over vitest's 10 s hook default on a cold machine. */
const IMPORT_TIMEOUT_MS = 120_000;
const DB_TEST_TIMEOUT_MS = 60_000;

// Explicit opt-in: CI supplies its disposable migrated PostgreSQL service.
describe.skipIf(process.env.BRANCH_PROMOTE_INTEGRATION !== '1')('promoting a version in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let branches: typeof import('./branches');
  const organizations: string[] = [];
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    branches = await import('./branches');
  }, IMPORT_TIMEOUT_MS);
  afterAll(async () => {
    if (organizations.length > 0) await db?.prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    await db?.prisma.$disconnect();
  }, DB_TEST_TIMEOUT_MS);

  const fixture = async () => {
    const id = `promote-${randomUUID()}`;
    const org = await db.prisma.organization.create({ data: { name: 'Synthetic promote' } });
    organizations.push(org.id);
    await db.prisma.project.create({ data: { id, organizationId: org.id, name: 'Synthetic promote', slug: id } });
    const main = await db.prisma.branch.create({ data: { projectId: id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: id, code: 'en', label: 'English', isDefault: true } });
    const base = { projectId: id, branchId: main.id, languageId: language.id };
    const guide = await db.prisma.page.create({ data: { ...base, kind: 'GROUP', title: 'Guide', slug: 'guide', path: 'guide' } });
    const billing = await db.prisma.page.create({
      data: { ...base, parentId: guide.id, title: 'Billing', slug: 'billing', path: 'guide/billing', content: 'Teh price' },
    });
    const legacy = await db.prisma.page.create({ data: { ...base, title: 'Legacy', slug: 'legacy', path: 'legacy' } });
    const version = await branches.createBranch(id, { name: 'v2' });
    return { projectId: id, main, version, base, guide, billing, legacy };
  };
  /** Backends waiting, directly or behind another waiter, on `holder`.
   *  PostgreSQL queues a second waiter on a row behind the first waiter, so
   *  `holder = ANY(pg_blocking_pids(pid))` alone undercounts; follow the chain. */
  const waitersOn = async (holder: number) => {
    const [row] = await db.prisma.$queryRaw<{ waiters: number }[]>(db.Prisma.sql`
      WITH RECURSIVE chain(pid) AS (
        SELECT a.pid FROM pg_stat_activity a WHERE ${holder}::int = ANY(pg_blocking_pids(a.pid))
        UNION
        SELECT a.pid FROM pg_stat_activity a JOIN chain c ON c.pid = ANY(pg_blocking_pids(a.pid))
      )
      SELECT count(*)::int AS waiters FROM chain`);
    return row?.waiters ?? 0;
  };
  const untilWaiting = async (holder: number, deadlineMs = 20_000) => {
    const deadline = Date.now() + deadlineMs;
    while ((await waitersOn(holder)) < 1) {
      if (Date.now() > deadline) throw new Error('The promote never waited on the save lock.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const mainPages = (projectId: string, branchId: string) =>
    db.prisma.page.findMany({ where: { projectId, branchId }, orderBy: { path: 'asc' }, select: { title: true, path: true, content: true } });

  it('keeps added pages, keeps deletions, and lets the version win a confirmed edit', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, base, guide, billing, legacy } = await fixture();
    await db.prisma.page.update({ where: { id: billing.id }, data: { content: 'The price' } });
    await db.prisma.page.create({ data: { ...base, parentId: guide.id, title: 'Refunds', slug: 'refunds', path: 'guide/refunds' } });
    await db.prisma.page.delete({ where: { id: legacy.id } });
    await db.prisma.page.updateMany({ where: { branchId: version.id, slug: 'billing' }, data: { content: 'Version price' } });

    const preview = await branches.getMergePreview(projectId, version.id);
    expect(preview.changedOnMainSinceFork.map((p) => [p.path, p.change])).toEqual([
      ['guide/billing', 'modified'],
      ['guide/refunds', 'added'],
      ['legacy', 'deleted'],
    ]);
    await expect(branches.mergeBranch(projectId, version.id)).rejects.toMatchObject({ status: 409, code: 'branch:main_changed' });
    expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).not.toBeNull();

    await branches.mergeBranch(projectId, version.id, { confirmChangedOnMain: true });
    expect(await mainPages(projectId, main.id)).toEqual([
      { title: 'Guide', path: 'guide', content: '' },
      { title: 'Billing', path: 'guide/billing', content: 'Version price' },
      { title: 'Refunds', path: 'guide/refunds', content: '' },
    ]);
  });

  it('refuses a promote when a save on main commits while the promote waits for its lock', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, billing } = await fixture();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saved: (pid: number) => void = () => undefined;
    const holding = new Promise<number>((resolve) => {
      saved = resolve;
    });
    const save = db.prisma.$transaction(
      async (tx) => {
        await tx.page.update({ where: { id: billing.id }, data: { content: 'Saved during promote' } });
        const [backend] = await tx.$queryRaw<{ pid: number }[]>(db.Prisma.sql`SELECT pg_backend_pid() AS pid`);
        saved(backend?.pid ?? -1);
        await gate;
      },
      { timeout: 30_000 },
    );
    const holder = await holding;
    const promote = branches.mergeBranch(projectId, version.id).then(
      () => null,
      (error: unknown) => error,
    );
    // The promote must be queued on the save's row lock before the save commits.
    try {
      await untilWaiting(holder);
    } finally {
      release();
    }
    await save;
    expect(await promote).toMatchObject({ status: 409, code: 'branch:main_changed' });
    expect((await mainPages(projectId, main.id)).find((p) => p.path === 'guide/billing')?.content).toBe('Saved during promote');
  });

  it('promotes an untouched main without confirmation', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version } = await fixture();
    await expect(branches.getMergePreview(projectId, version.id)).resolves.toEqual({ changedOnMainSinceFork: [], baselineComplete: true });
    await branches.mergeBranch(projectId, version.id);
    expect((await mainPages(projectId, main.id)).map((p) => p.path)).toEqual(['guide', 'guide/billing', 'legacy']);
    expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).toBeNull();
  });
});
