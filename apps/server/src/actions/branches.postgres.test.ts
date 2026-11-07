import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Importing the server actions (Prisma client, i18n catalogs) can take well
 *  over vitest's 10 s hook default on a cold machine. */
const IMPORT_TIMEOUT_MS = 120_000;
const DB_TEST_TIMEOUT_MS = 90_000;

// Explicit opt-in: CI supplies its disposable migrated PostgreSQL service.
// Every case creates its own organization and deletes it afterwards; shared
// tables are never truncated.
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
  }, IMPORT_TIMEOUT_MS);

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
      data: { ...base, parentId: guide.id, title: 'Billing', slug: 'billing', path: 'guide/billing', content: 'Main price', position: 1 },
    });
    const legacy = await db.prisma.page.create({ data: { ...base, title: 'Legacy', slug: 'legacy', path: 'legacy', position: 2 } });
    return { projectId: id, main, base, guide, billing, legacy };
  };
  const copyIn = (branchId: string, path: string) => db.prisma.page.findFirstOrThrow({ where: { branchId, path } });
  const pagesOn = (projectId: string, branchId: string) =>
    db.prisma.page.findMany({ where: { projectId, branchId }, orderBy: { path: 'asc' }, select: { id: true, path: true, content: true } });
  const promoteError = (projectId: string, id: string) =>
    branches.mergeBranch(projectId, id).then(
      () => null,
      (error: unknown) => error,
    );

  /** Backends waiting, directly or behind another waiter, on `holder`.
   *  PostgreSQL queues a second waiter on a row behind the first waiter, not
   *  the holder, so follow the `pg_blocking_pids` chain. */
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
  /** An autosave of `pageId` (content only: its own row lock, no project
   *  lock) that holds its transaction open until `during` is queued behind it,
   *  runs `meanwhile` (committed on its own connection) while `during` is still
   *  blocked, then commits. With `content: null` it only holds the row lock.
   *  Returns what `during` settled to. */
  const whileSaving = async (pageId: string, content: string | null, during: () => Promise<unknown>, meanwhile?: () => Promise<unknown>) => {
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
        await tx.$queryRaw(db.Prisma.sql`SELECT 1 FROM "page" WHERE "id" = ${pageId} FOR NO KEY UPDATE`);
        if (content !== null) await tx.page.update({ where: { id: pageId }, data: { content } });
        const [backend] = await tx.$queryRaw<{ pid: number }[]>(db.Prisma.sql`SELECT pg_backend_pid() AS pid`);
        saved(backend?.pid ?? -1);
        await gate;
      },
      { timeout: 30_000 },
    );
    const holder = await holding;
    const outcome = during().then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await untilWaiting(holder);
      await meanwhile?.();
    } finally {
      release();
    }
    await save;
    return outcome;
  };

  it('stores the v2 baseline #326 reads, hashed with #326’s expression', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, guide, billing } = await fixture();
    const version = await branches.createBranch(projectId, { name: 'v2' });
    const { forkedAt, forkBaseline } = await db.prisma.branch.findUniqueOrThrow({ where: { id: version.id } });
    expect(forkedAt).toBeInstanceOf(Date);
    const baseline = forkBaseline as { version: number; pages: Record<string, Record<string, unknown>> };
    expect(baseline.version).toBe(2);
    expect(Object.keys(baseline.pages).sort()).toEqual((await pagesOn(projectId, main.id)).map((p) => p.id).sort());
    // #326's expression, written out here rather than imported, for a known page and its copy.
    const hashOf = async (id: string) => {
      const [hit] = await db.prisma.$queryRaw<{ hash: string }[]>(db.Prisma.sql`
        SELECT md5(json_build_array("kind", "title", "slug", "icon", "description", "content", "config", "translationKey", "hidden")::text) AS "hash"
        FROM "page" WHERE "id" = ${id}`);
      return hit?.hash;
    };
    const copy = await copyIn(version.id, 'guide/billing');
    expect(baseline.pages[billing.id]).toEqual({
      copyId: copy.id,
      hash: await hashOf(billing.id),
      copyHash: await hashOf(copy.id),
      parentId: guide.id,
      position: 1,
      updatedAt: billing.updatedAt.toISOString(),
      title: 'Billing',
      path: 'guide/billing',
      languageId: billing.languageId,
      kind: 'PAGE',
    });
    expect(baseline.pages[billing.id]?.hash).toBe(baseline.pages[billing.id]?.copyHash);
  });

  it('refuses when main changed, keeping main and the version', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, base, billing, legacy } = await fixture();
    const version = await branches.createBranch(projectId, { name: 'v2' });
    await db.prisma.page.update({ where: { id: billing.id }, data: { content: 'Edited on main' } });
    await db.prisma.page.create({ data: { ...base, title: 'Refunds', slug: 'refunds', path: 'refunds', position: 3 } });
    await db.prisma.page.delete({ where: { id: legacy.id } });

    const preview = await branches.getMergePreview(projectId, version.id);
    expect(preview.baselineComplete).toBe(true);
    expect(preview.changedOnMainSinceFork.map((p) => [p.path, p.change, p.languageCode])).toEqual([
      ['guide/billing', 'modified', 'en'],
      ['legacy', 'deleted', 'en'],
      ['refunds', 'added', 'en'],
    ]);
    const error = await promoteError(projectId, version.id);
    expect(error).toMatchObject({ status: 409, code: 'branch:main_changed', details: { reason: 'main_changed' } });
    expect((error as { details: { changedOnMainSinceFork: unknown[] } }).details.changedOnMainSinceFork).toEqual(preview.changedOnMainSinceFork);
    expect((await pagesOn(projectId, main.id)).map((p) => [p.path, p.content])).toEqual([
      ['guide', ''],
      ['guide/billing', 'Edited on main'],
      ['refunds', ''],
    ]);
    expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).not.toBeNull();
  });

  it('refuses a version with no baseline and gives the count hint', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, billing } = await fixture();
    const version = await branches.createBranch(projectId, { name: 'v2' });
    // A version created before this release.
    await db.prisma.branch.update({ where: { id: version.id }, data: { forkedAt: null, forkBaseline: db.Prisma.DbNull } });
    await db.prisma.page.update({ where: { id: billing.id }, data: { content: 'Edited on main' } });

    await expect(branches.getMergePreview(projectId, version.id)).resolves.toEqual({ changedOnMainSinceFork: [], baselineComplete: false });
    const error = await promoteError(projectId, version.id);
    expect(error).toMatchObject({
      status: 409,
      code: 'branch:baseline_missing',
      details: { since: version.createdAt.toISOString(), mainPagesEditedOrCreatedSince: 1 },
    });
    expect((await pagesOn(projectId, main.id)).find((p) => p.path === 'guide/billing')?.content).toBe('Edited on main');
  });

  it('promotes as before when main is unchanged; a drag on main is not an edit', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, guide, billing, legacy } = await fixture();
    const version = await branches.createBranch(projectId, { name: 'v2' });
    await db.prisma.page.update({ where: { id: (await copyIn(version.id, 'guide/billing')).id }, data: { content: 'Version price' } });
    // Reorder main: every row's position and updatedAt move, but no content does.
    for (const [position, id] of [legacy.id, guide.id, billing.id].entries()) await db.prisma.page.update({ where: { id }, data: { position } });

    await expect(branches.getMergePreview(projectId, version.id)).resolves.toEqual({ changedOnMainSinceFork: [], baselineComplete: true });
    const versionIds = (await pagesOn(projectId, version.id)).map((p) => p.id).sort();
    await branches.mergeBranch(projectId, version.id);
    const after = await pagesOn(projectId, main.id);
    // Today's promote: main now holds the version's pages (their ids), and the version is gone.
    expect(after.map((p) => [p.path, p.content])).toEqual([
      ['guide', ''],
      ['guide/billing', 'Version price'],
      ['legacy', ''],
    ]);
    expect(after.map((p) => p.id).sort()).toEqual(versionIds);
    expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).toBeNull();
  });

  it('refuses when a save on main commits while the promote waits for its lock, and keeps the save', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, billing } = await fixture();
    const version = await branches.createBranch(projectId, { name: 'v2' });
    const outcome = await whileSaving(billing.id, 'Saved during promote', () => branches.mergeBranch(projectId, version.id));
    expect(outcome).toMatchObject({ status: 409, code: 'branch:main_changed' });
    expect((await pagesOn(projectId, main.id)).find((p) => p.path === 'guide/billing')?.content).toBe('Saved during promote');
    expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).not.toBeNull();
  });

  it.each([
    ['a root page', null, 'late'],
    ['a child page', 'guide', 'guide/late'],
  ] as const)(
    'refuses, keeping it, when %s is created on main while the promote is blocked',
    { timeout: DB_TEST_TIMEOUT_MS },
    async (_label, parent, path) => {
      const { projectId, main, base, guide, legacy } = await fixture();
      const version = await branches.createBranch(projectId, { name: 'v2' });
      // createPage takes no project lock; a child only needs KEY SHARE on its parent.
      const create = () =>
        db.prisma.page.create({
          data: { ...base, parentId: parent ? guide.id : null, title: 'Late', slug: 'late', path, position: 9 },
          select: { id: true },
        });
      let created: { id: string } | undefined;
      const outcome = await whileSaving(
        legacy.id,
        null,
        () => branches.mergeBranch(projectId, version.id),
        async () => {
          created = await create();
        },
      );
      expect(outcome).toMatchObject({
        status: 409,
        code: 'branch:main_changed',
        details: { changedOnMainSinceFork: [expect.objectContaining({ pageId: created?.id, path, change: 'added' })] },
      });
      expect((await pagesOn(projectId, main.id)).map((p) => p.path)).toEqual(
        ['guide', 'guide/billing', ...(parent ? ['guide/late'] : []), 'legacy', ...(parent ? [] : ['late'])].sort(),
      );
      expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).not.toBeNull();
    },
  );

  it('refuses, keeping it, when a child insert under a deleted main page commits while the promote waits to delete', {
    timeout: DB_TEST_TIMEOUT_MS,
  }, async () => {
    const { projectId, main, base, guide } = await fixture();
    const version = await branches.createBranch(projectId, { name: 'v2' });
    // The insert holds KEY SHARE on `guide` (compatible with the promote's NO
    // KEY UPDATE), so only the FOR UPDATE upgrade makes the promote wait for it.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: (value: { pid: number; id: string }) => void = () => undefined;
    const inserting = new Promise<{ pid: number; id: string }>((resolve) => {
      started = resolve;
    });
    const insert = db.prisma.$transaction(
      async (tx) => {
        const child = await tx.page.create({
          data: { ...base, parentId: guide.id, title: 'Late', slug: 'late', path: 'guide/late', position: 9 },
          select: { id: true },
        });
        const [backend] = await tx.$queryRaw<{ pid: number }[]>(db.Prisma.sql`SELECT pg_backend_pid() AS pid`);
        started({ pid: backend?.pid ?? -1, id: child.id });
        await gate;
      },
      { timeout: 30_000 },
    );
    const inserter = await inserting;
    const outcome = branches.mergeBranch(projectId, version.id).then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await untilWaiting(inserter.pid);
    } finally {
      release();
    }
    await insert;
    expect(await outcome).toMatchObject({
      status: 409,
      code: 'branch:main_changed',
      details: { changedOnMainSinceFork: [expect.objectContaining({ pageId: inserter.id, path: 'guide/late', change: 'added' })] },
    });
    expect((await pagesOn(projectId, main.id)).map((p) => p.path)).toContain('guide/late');
    expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).not.toBeNull();
  });

  it('promotes a version created from an empty main', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const id = `promote-${randomUUID()}`;
    const org = await db.prisma.organization.create({ data: { name: 'Synthetic promote' } });
    organizations.push(org.id);
    await db.prisma.project.create({ data: { id, organizationId: org.id, name: 'Synthetic promote', slug: id } });
    const main = await db.prisma.branch.create({ data: { projectId: id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: id, code: 'en', label: 'English', isDefault: true } });
    const version = await branches.createBranch(id, { name: 'v2' });
    const stored = await db.prisma.branch.findUniqueOrThrow({ where: { id: version.id }, select: { forkBaseline: true } });
    expect(stored.forkBaseline).toEqual({ version: 2, pages: {} });
    await db.prisma.page.create({
      data: { projectId: id, branchId: version.id, languageId: language.id, title: 'Welcome', slug: 'welcome', path: 'welcome' },
    });
    // No main pages: the upgrade is skipped and the fresh check runs with an empty id array.
    await branches.mergeBranch(id, version.id);
    expect((await pagesOn(id, main.id)).map((p) => p.path)).toEqual(['welcome']);
    expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).toBeNull();
  });

  it('promotes a project with more than 500 pages, nested, without a false failure', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, base } = await fixture();
    const rows: Array<{ id: string; parentId: string | null; kind: 'GROUP' | 'PAGE'; title: string; slug: string; path: string; position: number }> =
      [];
    for (let g = 0; g < 30; g++) {
      const groupId = `bulk-${randomUUID()}`;
      rows.push({ id: groupId, parentId: null, kind: 'GROUP', title: `Group ${g}`, slug: `g${g}`, path: `g${g}`, position: 10 + g });
      for (let p = 0; p < 20; p++) {
        rows.push({
          id: `bulk-${randomUUID()}`,
          parentId: groupId,
          kind: 'PAGE',
          title: `Page ${p}`,
          slug: `p${p}`,
          path: `g${g}/p${p}`,
          position: p,
        });
      }
    }
    await db.prisma.page.createMany({ data: rows.map((r) => ({ ...base, ...r })) });
    const total = rows.length + 3;
    expect(total).toBeGreaterThan(500);

    const version = await branches.createBranch(projectId, { name: 'v2' });
    expect(await db.prisma.page.count({ where: { branchId: version.id } })).toBe(total);
    await branches.mergeBranch(projectId, version.id);
    expect(await db.prisma.page.count({ where: { projectId, branchId: main.id } })).toBe(total);
    expect(await db.prisma.page.count({ where: { projectId, NOT: { branchId: main.id } } })).toBe(0);
  });

  describe('a version copied from another version', () => {
    it('promotes when nothing changed on main', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
      const { projectId, main } = await fixture();
      const a = await branches.createBranch(projectId, { name: 'a' });
      await db.prisma.page.update({ where: { id: (await copyIn(a.id, 'guide/billing')).id }, data: { content: 'A price' } });
      const b = await branches.createBranch(projectId, { name: 'b', fromBranchId: a.id });
      await branches.mergeBranch(projectId, b.id);
      expect((await pagesOn(projectId, main.id)).find((p) => p.path === 'guide/billing')?.content).toBe('A price');
    });

    it('refuses when main changed after the source version was copied', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
      const { projectId, billing } = await fixture();
      const a = await branches.createBranch(projectId, { name: 'a' });
      await db.prisma.page.update({ where: { id: billing.id }, data: { content: 'Edited before b' } });
      const b = await branches.createBranch(projectId, { name: 'b', fromBranchId: a.id });
      await expect(promoteError(projectId, b.id)).resolves.toMatchObject({ status: 409, code: 'branch:main_changed' });
    });

    it('refuses after the source version was promoted (expected over-refusal)', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
      const { projectId } = await fixture();
      const a = await branches.createBranch(projectId, { name: 'a' });
      const b = await branches.createBranch(projectId, { name: 'b', fromBranchId: a.id });
      await branches.mergeBranch(projectId, a.id);
      await expect(promoteError(projectId, b.id)).resolves.toMatchObject({ status: 409, code: 'branch:main_changed' });
    });

    it('keeps its copied baseline when the source version is deleted', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
      const { projectId } = await fixture();
      const a = await branches.createBranch(projectId, { name: 'a' });
      const b = await branches.createBranch(projectId, { name: 'b', fromBranchId: a.id });
      const fork = (id: string) => db.prisma.branch.findUniqueOrThrow({ where: { id }, select: { forkedAt: true, forkBaseline: true } });
      const before = await fork(b.id);
      const fromA = await fork(a.id);
      type Pages = Record<string, { copyId: string; hash: string }>;
      const pagesOf = (value: unknown) => (value as { pages: Pages }).pages;
      // Same fork time and main pages; each copy id now names b's own copy.
      expect(before.forkedAt).toEqual(fromA.forkedAt);
      expect(Object.keys(pagesOf(before.forkBaseline)).sort()).toEqual(Object.keys(pagesOf(fromA.forkBaseline)).sort());
      const bIds = new Set((await pagesOn(projectId, b.id)).map((p) => p.id));
      for (const [mainId, e] of Object.entries(pagesOf(before.forkBaseline))) {
        expect(bIds.has(e.copyId)).toBe(true);
        expect(e.hash).toBe(pagesOf(fromA.forkBaseline)[mainId]?.hash);
      }
      await branches.deleteBranch(projectId, a.id);
      expect(await fork(b.id)).toEqual(before);
      await branches.mergeBranch(projectId, b.id);
    });

    it('has no baseline when the source has none', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
      const { projectId, billing } = await fixture();
      const a = await branches.createBranch(projectId, { name: 'a' });
      await db.prisma.branch.update({ where: { id: a.id }, data: { forkedAt: null, forkBaseline: db.Prisma.DbNull } });
      // Main changes after a was made but before b: b's hint counts from a's time.
      await db.prisma.page.update({ where: { id: billing.id }, data: { content: 'Edited before b' } });
      const b = await branches.createBranch(projectId, { name: 'b', fromBranchId: a.id });
      await expect(promoteError(projectId, b.id)).resolves.toMatchObject({
        status: 409,
        code: 'branch:baseline_missing',
        details: { since: a.createdAt.toISOString(), mainPagesEditedOrCreatedSince: 1 },
      });
    });
  });
});
