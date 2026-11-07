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
  const users: string[] = [];
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    branches = await import('./branches');
  }, IMPORT_TIMEOUT_MS);
  afterAll(async () => {
    if (organizations.length > 0) await db?.prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    if (users.length > 0) await db?.prisma.user.deleteMany({ where: { id: { in: users } } });
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
      data: { ...base, parentId: guide.id, title: 'Billing', slug: 'billing', path: 'guide/billing', content: 'Teh price', position: 1 },
    });
    const legacy = await db.prisma.page.create({ data: { ...base, title: 'Legacy', slug: 'legacy', path: 'legacy', position: 2 } });
    const version = await branches.createBranch(id, { name: 'v2' });
    return { projectId: id, main, version, base, guide, billing, legacy };
  };
  /** The version's copy of a main page, found by its address. */
  const copyIn = (branchId: string, path: string) => db.prisma.page.findFirstOrThrow({ where: { branchId, path } });

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
  /** Run `work` in a transaction and hold it open while `during` runs; once
   *  `during` is queued behind it, run `meanwhile`, then commit (or, with
   *  `rollback`, roll back). Returns what `during` settled to. */
  const whileHolding = async (
    work: (tx: import('@nibleaf/database').Prisma.TransactionClient) => Promise<unknown>,
    during: () => Promise<unknown>,
    { meanwhile, rollback = false }: { meanwhile?: () => Promise<unknown>; rollback?: boolean } = {},
  ) => {
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
        await work(tx);
        const [backend] = await tx.$queryRaw<{ pid: number }[]>(db.Prisma.sql`SELECT pg_backend_pid() AS pid`);
        saved(backend?.pid ?? -1);
        await gate;
        if (rollback) throw new Error('rolled back on purpose');
      },
      { timeout: 30_000 },
    );
    const settled = save.then(
      () => undefined,
      (error: unknown) => {
        if (!rollback) throw error;
      },
    );
    const holder = await holding;
    const outcome = during().then(
      () => null,
      (error: unknown) => error,
    );
    // `during` must be queued on the held lock before it is released.
    try {
      await untilWaiting(holder);
      await meanwhile?.();
    } finally {
      release();
    }
    await settled;
    return outcome;
  };
  /** The confirmation for the preview as it is now. */
  const confirmed = async (projectId: string, versionId: string) => ({
    confirmPreview: (await branches.getMergePreview(projectId, versionId)).fingerprint,
  });
  /** An autosave of `pageId`: a content-only edit, its own row lock, no project lock. */
  const whileSaving = (pageId: string, content: string, during: () => Promise<unknown>) =>
    whileHolding(async (tx) => {
      await tx.$queryRaw(db.Prisma.sql`SELECT 1 FROM "page" WHERE "id" = ${pageId} FOR NO KEY UPDATE`);
      await tx.page.update({ where: { id: pageId }, data: { content } });
    }, during);
  const writer = async () => {
    const user = await db.prisma.user.create({ data: { name: 'Synthetic writer', email: `writer-${randomUUID()}@example.test` } });
    users.push(user.id);
    return user;
  };
  const pagesOn = (projectId: string, branchId: string) =>
    db.prisma.page.findMany({
      where: { projectId, branchId },
      orderBy: { path: 'asc' },
      select: { id: true, title: true, path: true, content: true },
    });
  const strip = (pages: Array<{ id: string; title: string; path: string; content: string }>) => pages.map(({ id: _id, ...rest }) => rest);

  it('keeps added pages, keeps deletions, and lets the version win a confirmed edit, in place', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, base, guide, billing, legacy } = await fixture();
    await db.prisma.page.update({ where: { id: billing.id }, data: { content: 'The price' } });
    await db.prisma.page.create({ data: { ...base, parentId: guide.id, title: 'Refunds', slug: 'refunds', path: 'guide/refunds', position: 3 } });
    await db.prisma.page.delete({ where: { id: legacy.id } });
    await db.prisma.page.updateMany({ where: { branchId: version.id, slug: 'billing' }, data: { content: 'Version price' } });

    const preview = await branches.getMergePreview(projectId, version.id);
    expect(preview.changedOnMainSinceFork.map((p) => [p.path, p.change, p.onPromote])).toEqual([
      ['guide/billing', 'modified', 'replaced'],
      ['guide/refunds', 'added', 'kept'],
      ['legacy', 'deleted', 'removed'],
    ]);
    await expect(branches.mergeBranch(projectId, version.id)).rejects.toMatchObject({ status: 409, code: 'branch:main_changed' });
    expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).not.toBeNull();

    await branches.mergeBranch(projectId, version.id, { confirmPreview: preview.fingerprint });
    const after = await pagesOn(projectId, main.id);
    expect(strip(after)).toEqual([
      { title: 'Guide', path: 'guide', content: '' },
      { title: 'Billing', path: 'guide/billing', content: 'Version price' },
      { title: 'Refunds', path: 'guide/refunds', content: '' },
    ]);
    // Main's page keeps its id: the version's text was written into it.
    expect(after.find((p) => p.path === 'guide/billing')?.id).toBe(billing.id);
  });

  it('keeps one page per address across successive promotions of versions forked together', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version: v2, billing } = await fixture();
    const v3 = await branches.createBranch(projectId, { name: 'v3' });
    await db.prisma.page.update({ where: { id: (await copyIn(v2.id, 'guide/billing')).id }, data: { content: 'V2 price' } });
    await db.prisma.page.update({ where: { id: (await copyIn(v3.id, 'guide/billing')).id }, data: { content: 'V3 price' } });

    await branches.mergeBranch(projectId, v2.id);
    const preview = await branches.getMergePreview(projectId, v3.id);
    expect(preview.changedOnMainSinceFork.map((p) => [p.pageId, p.change, p.onPromote])).toEqual([[billing.id, 'modified', 'replaced']]);
    await branches.mergeBranch(projectId, v3.id, { confirmPreview: preview.fingerprint });

    const after = await pagesOn(projectId, main.id);
    expect(strip(after)).toEqual([
      { title: 'Guide', path: 'guide', content: '' },
      { title: 'Billing', path: 'guide/billing', content: 'V3 price' },
      { title: 'Legacy', path: 'legacy', content: '' },
    ]);
    expect(after.find((p) => p.path === 'guide/billing')?.id).toBe(billing.id);
  });

  it('refuses a promote when a save on main commits while the promote waits for its lock', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, billing } = await fixture();
    const outcome = await whileSaving(billing.id, 'Saved during promote', () => branches.mergeBranch(projectId, version.id));
    expect(outcome).toMatchObject({ status: 409, code: 'branch:main_changed' });
    expect((await pagesOn(projectId, main.id)).find((p) => p.path === 'guide/billing')?.content).toBe('Saved during promote');
  });

  it('keeps a version autosave that commits while the promote waits for its lock', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, legacy } = await fixture();
    // Main deleted "Legacy"; the version's copy is untouched, so promote would drop it...
    await db.prisma.page.delete({ where: { id: legacy.id } });
    const copy = await copyIn(version.id, 'legacy');
    const reviewed = await confirmed(projectId, version.id);
    // ...unless the writer's autosave on that copy lands first. It must be
    // seen, not deleted; and since it changes what promote does with the page,
    // the confirmation the writer gave no longer fits.
    const outcome = await whileSaving(copy.id, 'Rewritten in the version', () => branches.mergeBranch(projectId, version.id, reviewed));
    expect(outcome).toMatchObject({ status: 409, code: 'branch:main_changed' });
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: copy.id } })).content).toBe('Rewritten in the version');
    await branches.mergeBranch(projectId, version.id, await confirmed(projectId, version.id));
    expect((await pagesOn(projectId, main.id)).find((p) => p.path === 'legacy')?.content).toBe('Rewritten in the version');
  });

  it('treats a drag in the page tree, on either side, as no edit', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, legacy } = await fixture();
    await db.prisma.page.delete({ where: { id: legacy.id } });
    // The tree sends every page on each drop, and every row's updatedAt moves.
    const reorder = async (branchId: string) => {
      const rows = await db.prisma.page.findMany({ where: { branchId }, orderBy: { position: 'asc' } });
      for (const [i, p] of rows.entries()) await db.prisma.page.update({ where: { id: p.id }, data: { position: rows.length - i } });
    };
    await reorder(main.id);
    await reorder(version.id);

    const preview = await branches.getMergePreview(projectId, version.id);
    expect(preview.changedOnMainSinceFork.map((p) => [p.path, p.change, p.onPromote])).toEqual([['legacy', 'deleted', 'removed']]);
    await branches.mergeBranch(projectId, version.id, await confirmed(projectId, version.id));
    expect((await pagesOn(projectId, main.id)).map((p) => p.path)).toEqual(['guide', 'guide/billing']);
  });

  it('gives a version page a numbered address when main added a page at the same one', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, base, guide } = await fixture();
    await db.prisma.page.create({ data: { ...base, parentId: guide.id, title: 'Refunds (main)', slug: 'refunds', path: 'guide/refunds' } });
    const versionGuide = await copyIn(version.id, 'guide');
    await db.prisma.page.create({
      data: { ...base, branchId: version.id, parentId: versionGuide.id, title: 'Refunds (version)', slug: 'refunds', path: 'guide/refunds' },
    });

    const preview = await branches.getMergePreview(projectId, version.id);
    expect(preview.changedOnMainSinceFork).toContainEqual(
      expect.objectContaining({ path: 'guide/refunds', change: 'conflict', onPromote: 'renamed', newPath: 'guide/refunds-2' }),
    );
    await branches.mergeBranch(projectId, version.id, await confirmed(projectId, version.id));
    const after = await pagesOn(projectId, main.id);
    expect(after.filter((p) => p.path.startsWith('guide/refunds')).map((p) => [p.path, p.title])).toEqual([
      ['guide/refunds', 'Refunds (main)'],
      ['guide/refunds-2', 'Refunds (version)'],
    ]);
  });

  it('keeps main ids, comments and reader grants when promoting a version made from another version', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version: v2, billing, legacy } = await fixture();
    const user = await writer();
    const comment = await db.prisma.comment.create({ data: { projectId, pageId: billing.id, userId: user.id, body: 'Check the price' } });
    const audience = await db.prisma.audience.create({ data: { projectId, name: 'Partners' } });
    const grant = await db.prisma.audienceGrant.create({
      data: { projectId, audienceId: audience.id, pageId: billing.id, scopeKey: `PAGE:${billing.id}` },
    });
    // V2 edits billing; V3 is made from V2 (as the editor does from the open version).
    await db.prisma.page.update({ where: { id: (await copyIn(v2.id, 'guide/billing')).id }, data: { content: 'V2 price' } });
    const v3 = await branches.createBranch(projectId, { name: 'v3', fromBranchId: v2.id });

    await expect(branches.getMergePreview(projectId, v3.id)).resolves.toMatchObject({ changedOnMainSinceFork: [], baselineComplete: true });
    await branches.mergeBranch(projectId, v3.id);
    const after = await pagesOn(projectId, main.id);
    expect(after.map((p) => [p.id, p.path, p.content])).toEqual([
      [expect.any(String), 'guide', ''],
      [billing.id, 'guide/billing', 'V2 price'],
      [legacy.id, 'legacy', ''],
    ]);
    expect(await db.prisma.comment.findUnique({ where: { id: comment.id } })).toMatchObject({ pageId: billing.id });
    expect(await db.prisma.audienceGrant.findUnique({ where: { id: grant.id } })).toMatchObject({ pageId: billing.id });
    // V2 still promotes cleanly afterwards: main's ids are the ones its baseline knows.
    const preview = await branches.getMergePreview(projectId, v2.id);
    expect(preview.changedOnMainSinceFork.filter((c) => c.change !== 'modified')).toEqual([]);
  });

  it('promotes a project with more than 1,000 nested pages', { timeout: 180_000 }, async () => {
    const { projectId, main, base } = await fixture();
    // 55 folders x 19 pages = 1,100 more pages, nested, on main.
    const folders = Array.from({ length: 55 }, (_, i) => ({
      ...base,
      id: `fold-${randomUUID()}`,
      kind: 'GROUP' as const,
      title: `F${i}`,
      slug: `f${i}`,
      path: `f${i}`,
      position: i,
    }));
    await db.prisma.page.createMany({ data: folders });
    await db.prisma.page.createMany({
      data: folders.flatMap((f, i) =>
        Array.from({ length: 19 }, (_, j) => ({
          ...base,
          id: `leaf-${randomUUID()}`,
          parentId: f.id,
          title: `P${i}.${j}`,
          slug: `p${j}`,
          path: `${f.path}/p${j}`,
          position: j,
        })),
      ),
    });
    const big = await branches.createBranch(projectId, { name: 'big' });
    // The version deletes one folder (and so its pages) and edits one page.
    await db.prisma.page.delete({ where: { id: (await copyIn(big.id, 'f3')).id } });
    await db.prisma.page.update({ where: { id: (await copyIn(big.id, 'f7/p2')).id }, data: { content: 'Edited in the version' } });

    await branches.mergeBranch(projectId, big.id);
    const after = await pagesOn(projectId, main.id);
    expect(after).toHaveLength(3 + 55 + 1045 - 20);
    expect(after.some((p) => p.path === 'f3' || p.path.startsWith('f3/'))).toBe(false);
    expect(after.find((p) => p.path === 'f7/p2')?.content).toBe('Edited in the version');
    expect(await db.prisma.page.count({ where: { branchId: big.id } })).toBe(0);
  });

  it('moves a comment that lands on a version copy while the promote waits, instead of deleting it', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, version, billing } = await fixture();
    const user = await writer();
    const copy = await copyIn(version.id, 'guide/billing');
    let commentId = '';
    const outcome = await whileHolding(
      async (tx) => {
        commentId = (await tx.comment.create({ data: { projectId, pageId: copy.id, userId: user.id, body: 'Left during the promote' } })).id;
      },
      () => branches.mergeBranch(projectId, version.id),
    );
    expect(outcome).toBeNull();
    expect(await db.prisma.comment.findUnique({ where: { id: commentId } })).toMatchObject({ pageId: billing.id });
  });

  it('refuses cleanly, and keeps the page, when a page is created under one the promote removes', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, base, legacy } = await fixture();
    // The version deleted "Legacy"; meanwhile someone creates a page under it on main.
    await db.prisma.page.delete({ where: { id: (await copyIn(version.id, 'legacy')).id } });
    let childId = '';
    const reviewed = await confirmed(projectId, version.id);
    const outcome = await whileHolding(
      async (tx) => {
        childId = (await tx.page.create({ data: { ...base, parentId: legacy.id, title: 'Child', slug: 'child', path: 'legacy/child' } })).id;
      },
      () => branches.mergeBranch(projectId, version.id, reviewed),
    );
    expect(outcome).toMatchObject({ status: 409, details: { reason: 'promote_raced' } });
    expect((await pagesOn(projectId, main.id)).map((p) => p.id)).toEqual(expect.arrayContaining([legacy.id, childId]));
    expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).not.toBeNull();
  });

  it('notices later a save on main that commits between the fork reading main and writing its copies', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, billing } = await fixture();
    // An uncommitted branch with the same name makes the fork wait at its
    // branch insert: after it read main, before any copy exists. The old code
    // hashed main in a second read after the copies, so a save landing here
    // ended up in the baseline but not in the copies, and was never seen.
    const name = 'v-race';
    let version: { id: string } | undefined;
    await whileHolding(
      (tx) => tx.branch.create({ data: { projectId, name, isDefault: false }, select: { id: true } }),
      async () => {
        version = await branches.createBranch(projectId, { name });
      },
      {
        meanwhile: () => db.prisma.page.update({ where: { id: billing.id }, data: { content: 'Saved while forking' } }),
        rollback: true,
      },
    );
    if (!version) throw new Error('the fork did not finish');
    expect((await copyIn(version.id, 'guide/billing')).content).toBe('Teh price');
    const preview = await branches.getMergePreview(projectId, version.id);
    expect(preview.changedOnMainSinceFork).toEqual([expect.objectContaining({ pageId: billing.id, change: 'modified', onPromote: 'kept' })]);
  });

  it('refuses a confirmation made before main changed again, and keeps that change', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, billing, legacy } = await fixture();
    // The writer reviews one change on main (Legacy edited)...
    await db.prisma.page.update({ where: { id: legacy.id }, data: { content: 'Main legacy' } });
    await db.prisma.page.update({ where: { id: (await copyIn(version.id, 'guide/billing')).id }, data: { content: 'Version price' } });
    const reviewed = await confirmed(projectId, version.id);
    // ...then someone edits Billing on main, which the version also edited.
    await db.prisma.page.update({ where: { id: billing.id }, data: { content: 'Main price' } });
    const refused = await branches.mergeBranch(projectId, version.id, reviewed).catch((error: unknown) => error);
    expect(refused).toMatchObject({ status: 409, code: 'branch:main_changed' });
    const fresh = (refused as { details: { fingerprint: string; changedOnMainSinceFork: Array<{ pageId: string; onPromote: string }> } }).details;
    expect(fresh.changedOnMainSinceFork).toContainEqual(expect.objectContaining({ pageId: billing.id, onPromote: 'replaced' }));
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: billing.id } })).content).toBe('Main price');
    // Confirming what is listed now goes through.
    await branches.mergeBranch(projectId, version.id, { confirmPreview: fresh.fingerprint });
    expect((await pagesOn(projectId, main.id)).find((p) => p.path === 'guide/billing')?.content).toBe('Version price');
  });

  it("keeps main's rename when the version only edited the text", { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, billing } = await fixture();
    await db.prisma.page.update({ where: { id: billing.id }, data: { slug: 'plans', path: 'guide/plans', hidden: true } });
    await db.prisma.page.update({ where: { id: (await copyIn(version.id, 'guide/billing')).id }, data: { content: 'The price' } });
    const preview = await branches.getMergePreview(projectId, version.id);
    expect(preview.changedOnMainSinceFork).toEqual([expect.objectContaining({ pageId: billing.id, onPromote: 'merged' })]);
    await branches.mergeBranch(projectId, version.id, { confirmPreview: preview.fingerprint });
    const after = await db.prisma.page.findUniqueOrThrow({ where: { id: billing.id } });
    expect(after).toMatchObject({ branchId: main.id, slug: 'plans', path: 'guide/plans', hidden: true, content: 'The price' });
  });

  it('promotes a version made from another version after that one, without duplicating its pages', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version: v2, base, legacy } = await fixture();
    // V2 creates guide/faq and deletes Legacy; V3 is made from V2.
    const v2Guide = await copyIn(v2.id, 'guide');
    await db.prisma.page.create({ data: { ...base, branchId: v2.id, parentId: v2Guide.id, title: 'FAQ', slug: 'faq', path: 'guide/faq' } });
    await db.prisma.page.delete({ where: { id: (await copyIn(v2.id, 'legacy')).id } });
    const v3 = await branches.createBranch(projectId, { name: 'v3', fromBranchId: v2.id });
    await db.prisma.page.update({ where: { id: (await copyIn(v3.id, 'guide/faq')).id }, data: { content: 'Answers from V3' } });

    await branches.mergeBranch(projectId, v2.id);
    await branches.mergeBranch(projectId, v3.id, await confirmed(projectId, v3.id));
    const after = await pagesOn(projectId, main.id);
    expect(after.map((p) => [p.path, p.content])).toEqual([
      ['guide', ''],
      ['guide/billing', 'Teh price'],
      ['guide/faq', 'Answers from V3'],
    ]);
    expect(after.some((p) => p.id === legacy.id)).toBe(false);
  });

  it('refuses a version without a baseline, and leaves main, its comments and grants alone', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, billing } = await fixture();
    const user = await writer();
    const comment = await db.prisma.comment.create({ data: { projectId, pageId: billing.id, userId: user.id, body: 'Keep me' } });
    await db.prisma.branch.update({ where: { id: version.id }, data: { forkBaseline: db.Prisma.DbNull } });
    await expect(branches.mergeBranch(projectId, version.id)).rejects.toMatchObject({
      status: 409,
      code: 'branch:baseline_missing',
      details: { since: expect.any(String), mainPagesEditedOrCreatedSince: expect.any(Number) },
    });
    await expect(branches.getMergePreview(projectId, version.id)).resolves.toMatchObject({ changedOnMainSinceFork: [], baselineComplete: false });
    expect((await pagesOn(projectId, main.id)).map((p) => p.id)).toContain(billing.id);
    expect(await db.prisma.comment.findUnique({ where: { id: comment.id } })).not.toBeNull();
  });

  it('refuses when a root page created on main during the promote takes an address the version brings in', {
    timeout: DB_TEST_TIMEOUT_MS,
  }, async () => {
    const { projectId, main, version, base } = await fixture();
    await db.prisma.page.create({ data: { ...base, branchId: version.id, title: 'Refunds (version)', slug: 'refunds', path: 'refunds' } });
    const copy = await copyIn(version.id, 'legacy');
    let lateId = '';
    // A version autosave holds the promote at its locked read; meanwhile a root
    // /refunds is created on main (createPage takes no project lock before #301).
    const outcome = await whileHolding(
      async (tx) => {
        await tx.$queryRaw(db.Prisma.sql`SELECT 1 FROM "page" WHERE "id" = ${copy.id} FOR NO KEY UPDATE`);
      },
      () => branches.mergeBranch(projectId, version.id),
      {
        meanwhile: async () => {
          lateId = (await db.prisma.page.create({ data: { ...base, title: 'Refunds (main)', slug: 'refunds', path: 'refunds' } })).id;
        },
      },
    );
    expect(outcome).toMatchObject({ status: 409, details: { reason: 'promote_raced' } });
    expect((await pagesOn(projectId, main.id)).map((p) => p.id)).toContain(lateId);
    expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).not.toBeNull();
  });

  it('moves reader grants from a version copy to the main page', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, version, billing } = await fixture();
    const copy = await copyIn(version.id, 'guide/billing');
    const audience = await db.prisma.audience.create({ data: { projectId, name: 'Partners' } });
    const grant = await db.prisma.audienceGrant.create({
      data: { projectId, audienceId: audience.id, pageId: copy.id, scopeKey: `PAGE:${copy.id}` },
    });
    await branches.mergeBranch(projectId, version.id);
    expect(await db.prisma.audienceGrant.findUnique({ where: { id: grant.id } })).toMatchObject({
      pageId: billing.id,
      scopeKey: `PAGE:${billing.id}`,
    });
  });

  it('refuses a version after an import replaced main, instead of duplicating its pages', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, base } = await fixture();
    // An import builds a replacement tree with the same paths and new ids, then swaps it in.
    const replacement = await branches.createImportReplacementBranch(projectId, 'gitbook', false);
    const guide = await db.prisma.page.create({
      data: { ...base, branchId: replacement.id, kind: 'GROUP', title: 'Guide', slug: 'guide', path: 'guide' },
    });
    await db.prisma.page.create({
      data: { ...base, branchId: replacement.id, parentId: guide.id, title: 'Billing', slug: 'billing', path: 'guide/billing' },
    });
    await branches.promoteImportReplacementBranch(projectId, replacement.id);
    expect(await db.prisma.branch.findUniqueOrThrow({ where: { id: version.id } })).toMatchObject({ forkedAt: null, forkBaseline: null });
    await expect(branches.mergeBranch(projectId, version.id)).rejects.toMatchObject({ status: 409, code: 'branch:baseline_missing' });
    expect((await pagesOn(projectId, main.id)).map((p) => p.path)).toEqual(['guide', 'guide/billing']);
  });

  it('refuses a version whose baseline knows none of main pages, even if nobody cleared it', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version, base } = await fixture();
    // Main's pages replaced behind the version's back (same paths, new ids).
    await db.prisma.page.deleteMany({ where: { branchId: main.id } });
    await db.prisma.page.create({ data: { ...base, kind: 'GROUP', title: 'Guide', slug: 'guide', path: 'guide' } });
    await expect(branches.mergeBranch(projectId, version.id)).rejects.toMatchObject({ status: 409, code: 'branch:baseline_missing' });
    await expect(branches.getMergePreview(projectId, version.id)).resolves.toMatchObject({ baselineComplete: false });
  });

  it('keeps a page deleted on main deleted when a later version made from its source is promoted untouched', {
    timeout: DB_TEST_TIMEOUT_MS,
  }, async () => {
    const { projectId, main, version: v2, base } = await fixture();
    const v2Guide = await copyIn(v2.id, 'guide');
    await db.prisma.page.create({ data: { ...base, branchId: v2.id, parentId: v2Guide.id, title: 'FAQ', slug: 'faq', path: 'guide/faq' } });
    const v3 = await branches.createBranch(projectId, { name: 'v3', fromBranchId: v2.id });
    await branches.mergeBranch(projectId, v2.id);
    // Main deletes the FAQ V2 brought in; V3 never touched its copy.
    await db.prisma.page.deleteMany({ where: { branchId: main.id, path: 'guide/faq' } });
    const preview = await branches.getMergePreview(projectId, v3.id);
    expect(preview.changedOnMainSinceFork).toContainEqual(expect.objectContaining({ path: 'guide/faq', change: 'deleted', onPromote: 'removed' }));
    await branches.mergeBranch(projectId, v3.id, { confirmPreview: preview.fingerprint });
    expect((await pagesOn(projectId, main.id)).map((p) => p.path)).not.toContain('guide/faq');
  });

  it('promotes a version made from another version first, then that one, keeping the newer edits and one page', {
    timeout: DB_TEST_TIMEOUT_MS,
  }, async () => {
    const { projectId, main, version: v2, base } = await fixture();
    const v2Guide = await copyIn(v2.id, 'guide');
    await db.prisma.page.create({
      data: { ...base, branchId: v2.id, parentId: v2Guide.id, title: 'FAQ', slug: 'faq', path: 'guide/faq', content: 'V2 answers' },
    });
    const v3 = await branches.createBranch(projectId, { name: 'v3', fromBranchId: v2.id });
    await db.prisma.page.update({ where: { id: (await copyIn(v3.id, 'guide/faq')).id }, data: { content: 'V3 answers' } });

    await branches.mergeBranch(projectId, v3.id);
    await branches.mergeBranch(projectId, v2.id, await confirmed(projectId, v2.id));
    const faqs = (await pagesOn(projectId, main.id)).filter((p) => p.path.startsWith('guide/faq'));
    expect(faqs.map((p) => [p.path, p.content])).toEqual([['guide/faq', 'V3 answers']]);
  });

  /** V2 forked from main and V3 forked from V2, both recorded exactly as #334
   *  records them: no provenance marker, no fields, aka, origin or
   *  reachedMain, and V3 carrying V2's fork time, `gapMs` before V3 was
   *  created. V2 created guide/faq before V3 was forked. */
  const legacyChain = async (gapMs: number) => {
    const setup = await fixture();
    const { projectId, version: v2, base } = setup;
    const v2Guide = await copyIn(v2.id, 'guide');
    await db.prisma.page.create({ data: { ...base, branchId: v2.id, parentId: v2Guide.id, title: 'FAQ', slug: 'faq', path: 'guide/faq' } });
    const v3 = await branches.createBranch(projectId, { name: 'v3', fromBranchId: v2.id });
    type Entry = Record<string, unknown> & { copyId: string };
    const strip = ({ fields: _f, copyConfigHash: _c, origin: _o, aka: _a, reachedMain: _r, ...entry }: Entry) => entry;
    const stored = (await db.prisma.branch.findUniqueOrThrow({ where: { id: v2.id } })).forkBaseline as { pages: Record<string, Entry> };
    // #334's fresh fork of main: main entries only, no marker, no additive keys.
    const v2Pages = Object.fromEntries(Object.entries(stored.pages).flatMap(([key, e]) => (e.origin ? [] : [[key, strip(e)]])));
    // #334's inheritance: the same entries, copy ids remapped onto V3's copies (by address).
    const v2Rows = await db.prisma.page.findMany({ where: { branchId: v2.id }, select: { id: true, path: true } });
    const v3Rows = await db.prisma.page.findMany({ where: { branchId: v3.id }, select: { id: true, path: true } });
    const v3ByPath = new Map(v3Rows.map((r) => [r.path, r.id]));
    const v3Of = new Map(v2Rows.map((r) => [r.id, v3ByPath.get(r.path) as string]));
    const v3Pages = Object.fromEntries(Object.entries(v2Pages).map(([key, e]) => [key, { ...e, copyId: v3Of.get(e.copyId as string) ?? e.copyId }]));
    const forkedAt = new Date(Date.now() - 60 * 60_000);
    await db.prisma.branch.update({
      where: { id: v2.id },
      data: { createdAt: forkedAt, forkedAt, forkBaseline: { version: 2, pages: v2Pages } as never },
    });
    await db.prisma.branch.update({
      where: { id: v3.id },
      data: { createdAt: new Date(forkedAt.getTime() + gapMs), forkedAt, forkBaseline: { version: 2, pages: v3Pages } as never },
    });
    return { ...setup, v2, v3 };
  };
  /** Promote exactly as the dialog would: confirm the preview just fetched.
   *  Without the refusal this writes; the outcome is the error, or null. */
  const promoteConfirmed = async (projectId: string, versionId: string) => {
    const preview = await branches.getMergePreview(projectId, versionId);
    return branches.mergeBranch(projectId, versionId, { confirmPreview: preview.fingerprint }).then(
      () => null,
      (error: unknown) => error,
    );
  };
  const refusedForBaseline = { status: 409, code: 'branch:baseline_missing' };
  const gaps = [
    ['2 s after its source (a short gap)', 2000],
    ['an hour after its source', 60 * 60_000],
  ] as const;

  it.each(gaps)(
    'refuses #334 versions, forked %s, instead of restoring a page main deleted',
    { timeout: DB_TEST_TIMEOUT_MS },
    async (_label, gapMs) => {
      const { projectId, main, v2, v3 } = await legacyChain(gapMs);
      // Trusted, V2 would put guide/faq on main; main then deletes it; V3,
      // untouched, would bring it back with an empty preview.
      const v2Outcome = await promoteConfirmed(projectId, v2.id);
      await db.prisma.page.deleteMany({ where: { branchId: main.id, path: 'guide/faq' } });
      const v3Outcome = await promoteConfirmed(projectId, v3.id);
      expect((await pagesOn(projectId, main.id)).map((p) => p.path)).not.toContain('guide/faq');
      expect(v3Outcome).toMatchObject(refusedForBaseline);
      expect(v2Outcome).toMatchObject(refusedForBaseline);
      await expect(branches.getMergePreview(projectId, v3.id)).resolves.toMatchObject({ baselineComplete: false });
    },
  );

  it.each(gaps)('refuses #334 versions, forked %s, instead of duplicating a page', { timeout: DB_TEST_TIMEOUT_MS }, async (_label, gapMs) => {
    const { projectId, main, v2, v3 } = await legacyChain(gapMs);
    // Trusted, V2 would put guide/faq on main and V3 would add its own copy as guide/faq-2.
    const v2Outcome = await promoteConfirmed(projectId, v2.id);
    const v3Outcome = await promoteConfirmed(projectId, v3.id);
    const faqs = (await pagesOn(projectId, main.id)).filter((p) => p.path.startsWith('guide/faq')).map((p) => p.path);
    expect(faqs).not.toContain('guide/faq-2');
    expect(faqs.length).toBeLessThanOrEqual(1);
    expect(v3Outcome).toMatchObject(refusedForBaseline);
    expect(v2Outcome).toMatchObject(refusedForBaseline);
  });

  it('asks before removing a page another version put on main, in either promote order', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    /** V2 creates guide/faq; V3 is made from V2. `deleteIn` deletes its FAQ
     *  copy; the other version is promoted first and lands the FAQ on main. */
    const scenario = async (deleteIn: 'v2' | 'v3') => {
      const { projectId, main, version: v2, base } = await fixture();
      const v2Guide = await copyIn(v2.id, 'guide');
      await db.prisma.page.create({ data: { ...base, branchId: v2.id, parentId: v2Guide.id, title: 'FAQ', slug: 'faq', path: 'guide/faq' } });
      const v3 = await branches.createBranch(projectId, { name: 'v3', fromBranchId: v2.id });
      const [first, last] = deleteIn === 'v3' ? [v2, v3] : [v3, v2];
      await db.prisma.page.delete({ where: { id: (await copyIn(last.id, 'guide/faq')).id } });
      await branches.mergeBranch(projectId, first.id);
      const faqOnMain = () => db.prisma.page.count({ where: { branchId: main.id, path: 'guide/faq' } });
      expect(await faqOnMain()).toBe(1);

      // Before anything is deleted: the preview lists it, and an unconfirmed promote is refused.
      const preview = await branches.getMergePreview(projectId, last.id);
      expect(preview.changedOnMainSinceFork).toContainEqual(expect.objectContaining({ path: 'guide/faq', change: 'added', onPromote: 'removed' }));
      await expect(branches.mergeBranch(projectId, last.id)).rejects.toMatchObject({ status: 409, code: 'branch:main_changed' });
      expect(await faqOnMain()).toBe(1);
      // Confirmed, the version's deletion goes through.
      await branches.mergeBranch(projectId, last.id, { confirmPreview: preview.fingerprint });
      expect(await faqOnMain()).toBe(0);
    };
    await scenario('v3'); // V2 promoted first, then V3, which deleted the FAQ.
    await scenario('v2'); // V3 promoted first, then V2, which deleted its own FAQ.
  });

  it('refuses a promote whose moves would put two pages inside each other', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, version, guide, legacy } = await fixture();
    // Main moves Legacy under Guide; the version moves Guide under Legacy.
    await db.prisma.page.update({ where: { id: legacy.id }, data: { parentId: guide.id, path: 'guide/legacy' } });
    const versionLegacy = await copyIn(version.id, 'legacy');
    await db.prisma.page.update({
      where: { id: (await copyIn(version.id, 'guide')).id },
      data: { parentId: versionLegacy.id, path: 'legacy/guide' },
    });

    await expect(branches.mergeBranch(projectId, version.id, await confirmed(projectId, version.id))).rejects.toMatchObject({
      status: 409,
      code: 'branch:promote_blocked',
      details: { reason: 'cycle' },
    });
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: guide.id } })).parentId).toBeNull();
    expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).not.toBeNull();
  });

  it('promotes an untouched main without confirmation', { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const { projectId, main, version } = await fixture();
    await expect(branches.getMergePreview(projectId, version.id)).resolves.toMatchObject({ changedOnMainSinceFork: [], baselineComplete: true });
    await branches.mergeBranch(projectId, version.id);
    expect((await pagesOn(projectId, main.id)).map((p) => p.path)).toEqual(['guide', 'guide/billing', 'legacy']);
    expect(await db.prisma.branch.findUnique({ where: { id: version.id } })).toBeNull();
  });
});
