import { createHash, randomUUID } from 'node:crypto';
import type { Member, Prisma } from '@nibleaf/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Opt in only against a migrated test database. Every fixture is synthetic and
// cleanup is restricted to the exact IDs created by this suite.
describe.skipIf(process.env.DATA_INTEGRITY_POSTGRES !== '1')('action data integrity in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let pages: typeof import('./pages');
  let languages: typeof import('./languages');
  let members: typeof import('./members');
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    pages = await import('./pages');
    languages = await import('./languages');
    members = await import('./members');
    // Loading the server action graph cold can take longer than the default
    // hook timeout on a busy machine.
  }, 120_000);
  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.project.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const fixture = async () => {
    const id = `integrity-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: id, slug: id } });
    const branch = await db.prisma.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: project.id, code: 'en', label: 'English', isDefault: true } });
    return { organization, project, branch, language };
  };

  /** Start both requests while their real PostgreSQL lock is held. Observing
   * blocked backends proves the actions actually serialize before their reads. */
  const whileLocked = async <T>(
    lock: (tx: Prisma.TransactionClient) => Promise<unknown>,
    requests: () => Promise<T>[],
    duringWait?: () => Promise<void>,
  ) => {
    let release: () => void = () => undefined;
    let held: (pid: number) => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<number>((resolve) => {
      held = resolve;
    });
    const holder = db.prisma.$transaction(
      async (tx) => {
        await lock(tx);
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        if (!backend) throw new Error('Missing PostgreSQL backend');
        held(backend.pid);
        await gate;
      },
      { timeout: 15_000 },
    );
    const pid = await Promise.race([
      acquired,
      holder.then(() => {
        throw new Error('Lock holder exited early');
      }),
    ]);
    const pending = requests();
    const outcomes = Promise.allSettled(pending);
    try {
      let waiting = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        // PostgreSQL queues a second waiter on the same row behind the first
        // waiter, not behind the holder, so count the whole wait chain.
        const [row] = await db.prisma.$queryRaw<Array<{ count: number }>>`
          WITH RECURSIVE chain(pid) AS (
            SELECT ${pid}::int
            UNION
            SELECT activity.pid FROM pg_stat_activity activity JOIN chain ON chain.pid = ANY(pg_blocking_pids(activity.pid))
            WHERE activity.datname = current_database()
          )
          SELECT (count(*) - 1)::int AS count FROM chain`;
        waiting = row?.count ?? 0;
        if (waiting >= pending.length) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBeGreaterThanOrEqual(pending.length);
      await duringWait?.();
    } finally {
      release();
      await holder;
    }
    return outcomes;
  };

  const staleTreeFixture = async () => {
    const { organization, project, branch, language } = await fixture();
    const editors: string[] = [];
    for (let index = 0; index < 2; index++) {
      const user = await db.prisma.user.create({ data: { name: 'Synthetic tree editor', email: `move-${randomUUID()}@example.invalid` } });
      userIds.push(user.id);
      editors.push(user.id);
      await db.prisma.member.create({ data: { organizationId: organization.id, userId: user.id, role: 'viewer', orgRole: 'member' } });
      await db.prisma.projectMember.create({ data: { organizationId: organization.id, projectId: project.id, userId: user.id, role: 'member' } });
    }
    const group = await pages.createPage(project.id, {
      title: 'Synthetic group',
      slug: 'group',
      kind: 'GROUP',
      branchId: branch.id,
      languageId: language.id,
    });
    const first = await pages.createPage(project.id, { title: 'Synthetic first', slug: 'first', branchId: branch.id, languageId: language.id });
    const second = await pages.createPage(project.id, { title: 'Synthetic second', slug: 'second', branchId: branch.id, languageId: language.id });
    const snapshot = await pages.listPages(project.id, undefined, branch.id);
    const access = await import('../lib/access');
    for (const userId of editors) expect((await access.resolveSiteAccess(userId, project.id)).role).toBe('member');
    // This compatibility envelope lets the exact regression also execute on
    // 960ba7c9: that action reads the stale legacy items. The fixed action
    // dispatches the pageId intent and ignores those obsolete snapshot fields.
    // The editor itself sends only the narrow intent, never these legacy items.
    const request = (pageId: string, expectedStructureRevision?: string) => ({
      pageId,
      parentId: group.id,
      position: { at: 'end' as const },
      ...(expectedStructureRevision ? { expectedStructureRevision } : {}),
      items: snapshot.map((page) => ({
        id: page.id,
        parentId: page.id === pageId ? group.id : page.parentId,
        position: page.id === pageId ? 0 : page.position,
      })),
    });
    return { project, group, first, second, snapshot, request };
  };

  it('council P1: two editors moving from one stale tree preserve both intents in PostgreSQL', async () => {
    const { project, group, first, second, request } = await staleTreeFixture();
    const outcomes = await whileLocked(
      (tx) => tx.$queryRaw`SELECT id FROM project WHERE id = ${project.id} FOR NO KEY UPDATE`,
      () => [pages.reorderPages(project.id, request(first.id)), pages.reorderPages(project.id, request(second.id))],
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    const moved = await db.prisma.page.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { position: 'asc' } });
    expect(moved.map((page) => page.parentId)).toEqual([group.id, group.id]);
    expect(moved.map((page) => page.position)).toEqual([0, 1]);
    expect(new Set(moved.map((page) => page.path))).toEqual(new Set(['group/first', 'group/second']));
  });

  it('council P1: a stale structure revision returns a typed 409 after the current-state lock', async () => {
    const { project, group, first, second, snapshot, request } = await staleTreeFixture();
    // Public revision protocol: SHA-256 of the ID-sorted structural tuples.
    const revision = createHash('sha256')
      .update(
        JSON.stringify(
          [...snapshot]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((page) => [page.id, page.parentId, page.branchId, page.languageId, page.position]),
        ),
      )
      .digest('hex');
    const outcomes = await whileLocked(
      (tx) => tx.$queryRaw`SELECT id FROM project WHERE id = ${project.id} FOR NO KEY UPDATE`,
      () => [pages.reorderPages(project.id, request(first.id, revision)), pages.reorderPages(project.id, request(second.id, revision))],
    );
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(refused?.status === 'rejected' ? refused.reason : null).toMatchObject({
      status: 409,
      code: 'database:conflict',
      details: { reason: 'structure_changed' },
    });
    expect(await db.prisma.page.count({ where: { projectId: project.id, parentId: group.id } })).toBe(1);
  });

  it('merges overlapping language sections after acquiring the project lock', async () => {
    const { project, language } = await fixture();
    const results = await whileLocked(
      (tx) => tx.$queryRaw`SELECT id FROM project WHERE id = ${project.id} FOR NO KEY UPDATE`,
      () => [
        languages.updateLanguage(project.id, language.id, { config: { banner: { message: 'Synthetic announcement' } } }),
        languages.updateLanguage(project.id, language.id, { config: { seo: { metaTitle: 'Synthetic documentation' } } }),
      ],
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect((await db.prisma.language.findUniqueOrThrow({ where: { id: language.id } })).config).toEqual({
      banner: { message: 'Synthetic announcement' },
      seo: { metaTitle: 'Synthetic documentation' },
    });
  });

  const memberFixture = async (legacyOwners = false) => {
    const { organization } = await fixture();
    const rows: Member[] = [];
    for (let index = 0; index < 3; index++) {
      const user = await db.prisma.user.create({ data: { name: 'Synthetic member', email: `integrity-${randomUUID()}@example.invalid` } });
      userIds.push(user.id);
      rows.push(
        await db.prisma.member.create({
          data: { organizationId: organization.id, userId: user.id, role: index === 0 || (legacyOwners && index === 1) ? 'owner' : 'admin' },
        }),
      );
    }
    const [owner, first, second] = rows;
    if (!owner || !first || !second) throw new Error('Missing member fixture');
    return { organization, owner, first, second };
  };

  it('reauthorizes concurrent ownership transfers under the organization lock', async () => {
    const { organization, owner, first, second } = await memberFixture();
    const results = await whileLocked(
      (tx) => tx.$queryRaw`SELECT id FROM organization WHERE id = ${organization.id} FOR NO KEY UPDATE`,
      () => [members.transferOwnership(organization.id, owner.userId, first.id), members.transferOwnership(organization.id, owner.userId, second.id)],
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.prisma.member.count({ where: { organizationId: organization.id, role: 'owner' } })).toBe(1);
  });

  it.each(['demote', 'remove'])('keeps a last legacy owner during overlapping %s requests', async (operation) => {
    const { organization, owner, first } = await memberFixture(true);
    const change = (id: string) =>
      operation === 'demote'
        ? members.updateMemberRole(organization.id, id, id === owner.id ? owner.userId : first.userId, { role: 'admin' })
        : members.removeMember(organization.id, id, id === owner.id ? owner.userId : first.userId);
    const results = await whileLocked(
      (tx) => tx.$queryRaw`SELECT id FROM organization WHERE id = ${organization.id} FOR NO KEY UPDATE`,
      () => [change(owner.id), change(first.id)],
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.prisma.member.count({ where: { organizationId: organization.id, role: 'owner' } })).toBe(1);
  });

  it('rejects the second conflicting move and commits consistent subtree paths', async () => {
    const { project, branch, language } = await fixture();
    const create = (slug: string, parentId: string | null = null) =>
      pages.createPage(project.id, {
        title: slug,
        slug,
        parentId,
        branchId: branch.id,
        languageId: language.id,
      });
    const group = await create('guides');
    const other = await create('other');
    const first = await create('intro');
    const second = await create('intro', other.id);
    const child = await create('child', first.id);
    const move = (id: string) => pages.reorderPages(project.id, { items: [{ id, parentId: group.id, position: 0 }] });
    const results = await whileLocked(
      (tx) => tx.$queryRaw`SELECT id FROM project WHERE id = ${project.id} FOR NO KEY UPDATE`,
      () => [move(first.id), move(second.id)],
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rows = await db.prisma.page.findMany({ where: { projectId: project.id } });
    expect(new Set(rows.map((page) => page.path)).size).toBe(rows.length);
    const parent = rows.find((page) => page.id === first.id);
    expect(rows.find((page) => page.id === child.id)?.path).toBe(`${parent?.path}/child`);
  });

  it('moves a subtree into another language in one transaction with free addresses', async () => {
    const { project, branch, language } = await fixture();
    const arabic = await db.prisma.language.create({ data: { projectId: project.id, code: 'ar', label: 'العربية', direction: 'RTL', position: 1 } });
    const create = (slug: string, parentId: string | null, languageId: string, translationKey?: string) =>
      pages.createPage(project.id, { title: slug, slug, parentId, branchId: branch.id, languageId, translationKey });
    const guide = await create('guide', null, language.id, 'guide');
    const child = await create('intro', guide.id, language.id);
    await create('guide', null, arabic.id, 'guide');
    await pages.reorderPages(project.id, { items: [{ id: guide.id, parentId: null, position: 5, languageId: arabic.id }] });
    const rows = await db.prisma.page.findMany({ where: { projectId: project.id } });
    const moved = rows.find((page) => page.id === guide.id);
    expect(moved).toMatchObject({ languageId: arabic.id, slug: 'guide-2', path: 'guide-2', translationKey: null });
    expect(rows.find((page) => page.id === child.id)).toMatchObject({ languageId: arabic.id, path: 'guide-2/intro' });
    const other = await db.prisma.language.create({ data: { projectId: (await fixture()).project.id, code: 'fr', label: 'Français' } });
    await expect(
      pages.reorderPages(project.id, { items: [{ id: guide.id, parentId: null, position: 0, languageId: other.id }] }),
    ).rejects.toMatchObject({ code: 'database:not_found' });
  });

  it('allocates distinct slugs for concurrent sibling creation', async () => {
    const { project, branch, language } = await fixture();
    const create = () => pages.createPage(project.id, { title: 'Intro', branchId: branch.id, languageId: language.id });
    const results = await whileLocked(
      (tx) => tx.$queryRaw`SELECT id FROM project WHERE id = ${project.id} FOR NO KEY UPDATE`,
      () => [create(), create()],
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect((await db.prisma.page.findMany({ where: { projectId: project.id }, orderBy: { slug: 'asc' } })).map((page) => page.path)).toEqual([
      'intro',
      'intro-2',
    ]);
  });

  it('preserves a URL edit that commits between the content autosave read and write', async () => {
    const { project, branch, language } = await fixture();
    const page = await pages.createPage(project.id, { title: 'Intro', branchId: branch.id, languageId: language.id });
    const results = await whileLocked(
      (tx) => tx.page.update({ where: { id: page.id }, data: { slug: 'start', path: 'start' } }),
      () => [pages.updatePage(project.id, page.id, { title: 'Intro updated', content: 'Synthetic autosave' })],
    );
    expect(results[0]?.status).toBe('fulfilled');
    expect(await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({
      slug: 'start',
      path: 'start',
      content: 'Synthetic autosave',
    });
  });
  it('autosaves title and content while a structural move holds project and page locks', async () => {
    const { project, branch, language } = await fixture();
    const group = await pages.createPage(project.id, { title: 'Guides', branchId: branch.id, languageId: language.id });
    const page = await pages.createPage(project.id, { title: 'Intro', branchId: branch.id, languageId: language.id });
    const results = await whileLocked(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "project" WHERE id = ${project.id} FOR NO KEY UPDATE`;
        await tx.$queryRaw`SELECT 1 FROM "page" WHERE "projectId" = ${project.id} ORDER BY id FOR NO KEY UPDATE`;
        await tx.page.update({ where: { id: page.id }, data: { parentId: group.id, path: 'guides/intro' } });
      },
      () => [pages.updatePage(project.id, page.id, { title: 'Intro updated', content: 'Concurrent autosave' })],
    );
    expect(results[0]?.status).toBe('fulfilled');
    expect(await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({
      parentId: group.id,
      slug: 'intro',
      path: 'guides/intro',
      title: 'Intro updated',
      content: 'Concurrent autosave',
    });
  });

  it('allows an AnalyticsEvent insert while createPage holds the production project lock', async () => {
    const { project, branch, language } = await fixture();
    await whileLocked(
      // Pause createPage at its branch FK check, after its project lock is held.
      (tx) => tx.$queryRaw`SELECT 1 FROM branch WHERE id = ${branch.id} FOR UPDATE`,
      () => [pages.createPage(project.id, { title: 'Intro', branchId: branch.id, languageId: language.id })],
      async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const inserted = await Promise.race([
            db.prisma.analyticsEvent.create({ data: { projectId: project.id, type: 'pageview' } }),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error('Analytics insert blocked by project lock')), 1500);
            }),
          ]);
          expect(inserted.projectId).toBe(project.id);
        } finally {
          clearTimeout(timer);
        }
      },
    );
  });

  it('merges a language save after a sync transaction releases the shared project lock', async () => {
    const { project, language } = await fixture();
    const results = await whileLocked(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "project" WHERE id = ${project.id} FOR NO KEY UPDATE`;
        await tx.$queryRaw`SELECT 1 FROM "page" WHERE "projectId" = ${project.id} ORDER BY id FOR NO KEY UPDATE`;
        await tx.language.update({ where: { id: language.id }, data: { config: { banner: { message: 'Saved by sync transaction' } } } });
      },
      () => [languages.updateLanguage(project.id, language.id, { config: { seo: { metaTitle: 'Saved by editor' } } })],
    );
    expect(results[0]?.status).toBe('fulfilled');
    expect((await db.prisma.language.findUniqueOrThrow({ where: { id: language.id } })).config).toEqual({
      banner: { message: 'Saved by sync transaction' },
      seo: { metaTitle: 'Saved by editor' },
    });
  });

  it('finishes a pool-sized burst of creates without global-client helper reads', async () => {
    const { project } = await fixture();
    // adapter-pg's default pool has ten connections. Each locked create must
    // perform its default branch/language lookups through its own transaction.
    const created = await Promise.all(Array.from({ length: 10 }, (_, index) => pages.createPage(project.id, { title: `Burst ${index}` })));
    expect(created).toHaveLength(10);
    expect(await db.prisma.page.count({ where: { projectId: project.id } })).toBe(10);
  }, 40_000);
});
