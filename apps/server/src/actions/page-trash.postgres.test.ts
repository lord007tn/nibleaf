import { randomUUID } from 'node:crypto';
import type { Prisma } from '@nibleaf/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// No ClickHouse or Redis in this suite: erasure's partition deletes and queued
// jobs are recorded, not sent.
vi.mock('@nibleaf/clickhouse', async (original) => ({
  ...(await original<typeof import('@nibleaf/clickhouse')>()),
  deleteProjectAiConversations: vi.fn(async () => undefined),
  deleteProjectAnalytics: vi.fn(async () => undefined),
  deleteProjectUsage: vi.fn(async () => undefined),
}));
vi.mock('@nibleaf/bullmq', async (original) => ({
  ...(await original<typeof import('@nibleaf/bullmq')>()),
  createJob: vi.fn(async () => undefined),
  getJob: vi.fn(async () => undefined),
  removeJob: vi.fn(async () => undefined),
  sendRequiredEmail: vi.fn(async () => undefined),
}));

/**
 * AUTH-12: deleting a page moves its subtree to a 30-day Trash; restore puts
 * it back under the page-move locks. Run with PAGE_TRASH_POSTGRES=1 and
 * POSTGRES_URL pointing at a migrated database. Every fixture is synthetic and
 * cleanup is restricted to the ids this suite created.
 */
describe.skipIf(process.env.PAGE_TRASH_POSTGRES !== '1')('page Trash on PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let pages: typeof import('./pages');
  let trash: typeof import('./page-trash');
  let deployments: typeof import('./deployments');
  let orgs: typeof import('./organizations');
  let projects: typeof import('./projects');
  let erasure: typeof import('@nibleaf/auth/tenant-erasure');
  let accountDeletion: typeof import('@nibleaf/auth/account-deletion');
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    pages = await import('./pages');
    trash = await import('./page-trash');
    deployments = await import('./deployments');
    orgs = await import('./organizations');
    projects = await import('./projects');
    erasure = await import('@nibleaf/auth/tenant-erasure');
    accountDeletion = await import('@nibleaf/auth/account-deletion');
  }, 120_000);
  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.usageIngestCheckpoint.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await db.prisma.project.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  }, 60_000);

  const person = async () => {
    const id = `trash-${randomUUID()}`;
    userIds.push(id);
    return db.prisma.user.create({ data: { id, name: 'Synthetic author', email: `${id}@example.invalid`, emailVerified: true } });
  };

  /** A site with a tree: intro, guide (group) › [setup › [deep], usage], last. */
  const fixture = async () => {
    const id = `trash-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: id, slug: id } });
    const branch = await db.prisma.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: project.id, code: 'en', label: 'English', isDefault: true } });
    const scope = { branchId: branch.id, languageId: language.id };
    const intro = await pages.createPage(project.id, { title: 'Intro', slug: 'intro', content: 'Welcome', ...scope });
    const guide = await pages.createPage(project.id, { title: 'Guide', slug: 'guide', kind: 'GROUP', ...scope });
    const setup = await pages.createPage(project.id, {
      title: 'Setup',
      slug: 'setup',
      parentId: guide.id,
      content: 'Install it',
      translationKey: 'setup',
    });
    const deep = await pages.createPage(project.id, { title: 'Deep', slug: 'deep', parentId: setup.id, content: 'Details' });
    const usage = await pages.createPage(project.id, { title: 'Usage', slug: 'usage', parentId: guide.id });
    const last = await pages.createPage(project.id, { title: 'Last', slug: 'last' });
    const author = await person();
    return { organization, project, branch, language, scope, intro, guide, setup, deep, usage, last, author };
  };

  const tree = async (projectId: string) =>
    db.prisma.page.findMany({
      where: { projectId },
      orderBy: [{ parentId: 'asc' }, { position: 'asc' }],
      select: { id: true, parentId: true, slug: true, path: true, position: true, title: true, translationKey: true, hidden: true },
    });

  it('moves the whole subtree, its comments, audience grants and import sources to Trash in one step', async () => {
    const f = await fixture();
    const comment = await db.prisma.comment.create({
      data: { projectId: f.project.id, pageId: f.deep.id, userId: f.author.id, body: 'Check this', anchor: { quote: 'Details' } },
    });
    const audience = await db.prisma.audience.create({ data: { projectId: f.project.id, name: 'Partners' } });
    const grant = await db.prisma.audienceGrant.create({
      data: { projectId: f.project.id, audienceId: audience.id, pageId: f.setup.id, scopeKey: `page:${f.setup.id}` },
    });
    await db.prisma.pageGitImportSource.create({ data: { pageId: f.setup.id, projectId: f.project.id, ...f.scope, path: 'docs/setup.md' } });

    const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
    expect(deleted).toMatchObject({ id: f.setup.id, pageCount: 2 });
    expect(deleted.expiresAt.getTime() - Date.now()).toBeGreaterThan(29.9 * 24 * 60 * 60 * 1000);
    expect(await db.prisma.page.count({ where: { id: { in: [f.setup.id, f.deep.id] } } })).toBe(0);
    expect(await db.prisma.comment.count({ where: { id: comment.id } })).toBe(0);
    expect(await db.prisma.audienceGrant.count({ where: { id: grant.id } })).toBe(0);
    expect(await db.prisma.pageGitImportSource.count({ where: { pageId: f.setup.id } })).toBe(0);

    const listed = await trash.listPageTrash(f.project.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: deleted.trashId,
      rootPageId: f.setup.id,
      title: 'Setup',
      pageCount: 2,
      parentId: f.guide.id,
      deletedBy: { id: f.author.id, name: 'Synthetic author' },
    });
    expect(listed[0]).not.toHaveProperty('payload');

    const restored = await trash.restorePageTrashItem(f.project.id, deleted.trashId);
    expect(restored).toMatchObject({ restoredPages: 2, slugChanged: false, movedToTopLevel: false, page: { id: f.setup.id, parentId: f.guide.id } });
    expect(await db.prisma.pageTrash.count({ where: { id: deleted.trashId } })).toBe(0);
    const after = await tree(f.project.id);
    expect(after.find((page) => page.id === f.deep.id)).toMatchObject({ parentId: f.setup.id, path: 'guide/setup/deep' });
    // Back in its old place: before Usage.
    const siblings = after.filter((page) => page.parentId === f.guide.id).map((page) => page.id);
    expect(siblings).toEqual([f.setup.id, f.usage.id]);
    expect(await db.prisma.comment.findUnique({ where: { id: comment.id } })).toMatchObject({ body: 'Check this', anchor: { quote: 'Details' } });
    expect(await db.prisma.audienceGrant.findUnique({ where: { id: grant.id } })).toMatchObject({ pageId: f.setup.id });
    expect(await db.prisma.pageGitImportSource.findUnique({ where: { pageId: f.setup.id } })).toMatchObject({ path: 'docs/setup.md' });
  });

  it('restores at the top level when the parent is gone, suffixing a taken address and recomputing paths', async () => {
    const f = await fixture();
    const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
    // The parent goes too (into its own Trash item), and a new top-level page takes "setup".
    await trash.deletePage(f.project.id, f.guide.id, f.author.id);
    const taken = await pages.createPage(f.project.id, { title: 'New setup', slug: 'setup', ...f.scope });
    const restored = await trash.restorePageTrashItem(f.project.id, deleted.trashId);
    expect(restored).toMatchObject({
      slugChanged: true,
      movedToTopLevel: true,
      page: { id: f.setup.id, parentId: null, slug: 'setup-2', path: 'setup-2' },
    });
    const after = await tree(f.project.id);
    expect(after.find((page) => page.id === f.deep.id)).toMatchObject({ parentId: f.setup.id, path: 'setup-2/deep' });
    expect(after.find((page) => page.id === taken.id)).toMatchObject({ slug: 'setup', path: 'setup' });
    // Last among the top-level pages, every sibling with its own position.
    const top = after.filter((page) => page.parentId === null);
    expect(top.at(-1)?.id).toBe(f.setup.id);
    expect(new Set(top.map((page) => page.position)).size).toBe(top.length);
  });

  it('drops a translation link another page of the language took meanwhile', async () => {
    const f = await fixture();
    const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
    await pages.createPage(f.project.id, { title: 'Replacement', slug: 'replacement', translationKey: 'setup', ...f.scope });
    await trash.restorePageTrashItem(f.project.id, deleted.trashId);
    expect((await tree(f.project.id)).find((page) => page.id === f.setup.id)?.translationKey).toBeNull();
  });

  it('keeps trashed pages out of the publish snapshot, and leaves generated redirects alone', async () => {
    const f = await fixture();
    const redirects = [{ from: '/old-intro', to: '/intro', permanent: true, generated: true }];
    await db.prisma.project.update({ where: { id: f.project.id }, data: { config: { redirects } } });
    const ids = (snapshot: Awaited<ReturnType<typeof deployments.getCurrentSnapshot>>) => snapshot.pages.map((page) => page.id);

    // The publish snapshot is what the live site and its search index are built
    // from (publish → reindex-project). The trashed subtree is absent at once.
    const deleted = await trash.deletePage(f.project.id, f.guide.id, f.author.id);
    const without = await deployments.getCurrentSnapshot(f.project.id);
    for (const id of [f.guide.id, f.setup.id, f.deep.id, f.usage.id]) expect(ids(without)).not.toContain(id);
    expect(ids(without)).toContain(f.intro.id);
    const pending = await deployments.getPendingChanges(f.project.id, without);
    expect(JSON.stringify(pending)).not.toContain('Install it');

    // A page takes the address meanwhile, so restore renames the group.
    await pages.createPage(f.project.id, { title: 'Guide 2', slug: 'guide', ...f.scope });
    await trash.restorePageTrashItem(f.project.id, deleted.trashId);
    const back = await deployments.getCurrentSnapshot(f.project.id);
    for (const id of [f.guide.id, f.setup.id, f.deep.id, f.usage.id]) expect(ids(back)).toContain(id);
    expect(back.pages.find((page) => page.id === f.deep.id)?.path).toBe('guide-2/setup/deep');
    const config = (await db.prisma.project.findUniqueOrThrow({ where: { id: f.project.id } })).config as { redirects: unknown };
    expect(config.redirects).toEqual(redirects);
  });

  it('restores a payload written before a newer column existed, filling its default', async () => {
    const f = await fixture();
    await pages.updatePage(f.project.id, f.setup.id, { hidden: true, icon: 'book' });
    const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
    const row = await db.prisma.pageTrash.findUniqueOrThrow({ where: { id: deleted.trashId } });
    const payload = row.payload as { pages: Array<Record<string, unknown>> };
    // As if written by a release that predates hidden/icon/config/translationKey.
    const legacy = {
      ...payload,
      pages: payload.pages.map(({ hidden: _h, icon: _i, config: _c, translationKey: _t, ...page }) => page),
    };
    await db.prisma.pageTrash.update({ where: { id: row.id }, data: { payload: legacy as Prisma.InputJsonObject } });
    await trash.restorePageTrashItem(f.project.id, deleted.trashId);
    const restored = await db.prisma.page.findUniqueOrThrow({ where: { id: f.setup.id } });
    expect(restored).toMatchObject({ hidden: false, icon: null, config: null, translationKey: null, content: 'Install it' });
  });

  it('refuses, with a clear error and nothing changed, a payload it cannot map', async () => {
    const f = await fixture();
    const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
    const row = await db.prisma.pageTrash.findUniqueOrThrow({ where: { id: deleted.trashId } });
    const payload = row.payload as { schemaVersion: number; pages: Array<Record<string, unknown>> };
    await db.prisma.pageTrash.update({ where: { id: row.id }, data: { payload: { ...payload, schemaVersion: 99 } as Prisma.InputJsonObject } });
    await expect(trash.restorePageTrashItem(f.project.id, row.id)).rejects.toMatchObject({
      code: 'page:trash_unrestorable',
      status: 422,
      details: { reason: 'unsupported_version', schemaVersion: 99 },
    });
    const noSlug = { ...payload, pages: payload.pages.map(({ slug: _s, ...page }) => page) };
    await db.prisma.pageTrash.update({ where: { id: row.id }, data: { payload: noSlug as Prisma.InputJsonObject } });
    await expect(trash.restorePageTrashItem(f.project.id, row.id)).rejects.toMatchObject({
      code: 'page:trash_unrestorable',
      details: { reason: 'invalid_payload' },
    });
    expect(await db.prisma.page.count({ where: { id: f.setup.id } })).toBe(0);
    expect(await db.prisma.pageTrash.count({ where: { id: row.id } })).toBe(1);
  });

  /** Hold the project's tree lock in another transaction while `request` starts,
   * prove it is waiting on that lock, then run `edit` and release. */
  const whileTreeLocked = async <T>(projectId: string, request: () => Promise<T>, edit: (tx: Prisma.TransactionClient) => Promise<void>) => {
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
        await tx.$queryRaw`SELECT 1 FROM "project" WHERE id = ${projectId} FOR NO KEY UPDATE`;
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        held(backend?.pid ?? 0);
        await gate;
        await edit(tx);
      },
      { timeout: 15_000 },
    );
    const pid = await acquired;
    const outcome = request().then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    );
    let waiting = 0;
    for (let attempt = 0; attempt < 100 && waiting < 1; attempt++) {
      const [row] = await db.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`;
      waiting = row?.count ?? 0;
      if (waiting < 1) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBeGreaterThanOrEqual(1);
    release();
    await holder;
    return outcome;
  };

  it('waits for a concurrent tree edit, then restores against the tree that edit left', async () => {
    const f = await fixture();
    const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
    // While the restore waits, another editor removes its parent group.
    const outcome = await whileTreeLocked(
      f.project.id,
      () => trash.restorePageTrashItem(f.project.id, deleted.trashId),
      async (tx) => {
        await tx.page.delete({ where: { id: f.guide.id } });
      },
    );
    expect(outcome).toMatchObject({ status: 'fulfilled', value: { movedToTopLevel: true, page: { parentId: null, path: 'setup' } } });
    expect(await db.prisma.page.findUniqueOrThrow({ where: { id: f.deep.id } })).toMatchObject({ path: 'setup/deep' });
  });

  it('refuses a restore whose expected tree revision a concurrent edit changed', async () => {
    const f = await fixture();
    const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
    const revision = pages.pageStructureRevision(await pages.listPages(f.project.id));
    const outcome = await whileTreeLocked(
      f.project.id,
      () => trash.restorePageTrashItem(f.project.id, deleted.trashId, { expectedStructureRevision: revision }),
      async (tx) => {
        await tx.page.update({ where: { id: f.last.id }, data: { position: 99 } });
      },
    );
    expect(outcome).toMatchObject({ status: 'rejected', reason: { status: 409, details: { reason: 'structure_changed' } } });
    expect(await db.prisma.page.count({ where: { id: f.setup.id } })).toBe(0);
    expect(await db.prisma.pageTrash.count({ where: { id: deleted.trashId } })).toBe(1);
    // With a fresh revision it goes through.
    const fresh = pages.pageStructureRevision(await pages.listPages(f.project.id));
    await expect(trash.restorePageTrashItem(f.project.id, deleted.trashId, { expectedStructureRevision: fresh })).resolves.toMatchObject({
      page: { id: f.setup.id },
    });
  });

  it('restores once when two restores race', async () => {
    const f = await fixture();
    const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
    const results = await Promise.allSettled([
      trash.restorePageTrashItem(f.project.id, deleted.trashId),
      trash.restorePageTrashItem(f.project.id, deleted.trashId),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 404 });
    expect(await db.prisma.page.count({ where: { id: { in: [f.setup.id, f.deep.id] } } })).toBe(2);
  });

  it('purges expired items whenever Trash is read, restored from or deleted from', async () => {
    const f = await fixture();
    const expire = (id: string) => db.prisma.pageTrash.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const a = await trash.deletePage(f.project.id, f.intro.id, f.author.id);
    await expire(a.trashId);
    expect(await trash.listPageTrash(f.project.id)).toEqual([]);
    expect(await db.prisma.pageTrash.count({ where: { id: a.trashId } })).toBe(0);

    const b = await trash.deletePage(f.project.id, f.last.id, f.author.id);
    await expire(b.trashId);
    await expect(trash.restorePageTrashItem(f.project.id, b.trashId)).rejects.toMatchObject({ status: 404 });
    expect(await db.prisma.page.count({ where: { id: f.last.id } })).toBe(0);

    const c = await trash.deletePage(f.project.id, f.usage.id, f.author.id);
    const d = await trash.deletePage(f.project.id, f.deep.id, f.author.id);
    await expire(c.trashId);
    await expect(trash.purgePageTrashItem(f.project.id, d.trashId)).resolves.toEqual({ id: d.trashId });
    expect(await db.prisma.pageTrash.count({ where: { id: { in: [c.trashId, d.trashId] } } })).toBe(0);
  });

  it('deletes forever only inside its own site', async () => {
    const f = await fixture();
    const other = await fixture();
    const deleted = await trash.deletePage(f.project.id, f.intro.id, f.author.id);
    await expect(trash.purgePageTrashItem(other.project.id, deleted.trashId)).rejects.toMatchObject({ status: 404 });
    await expect(trash.restorePageTrashItem(other.project.id, deleted.trashId)).rejects.toMatchObject({ status: 404 });
    expect(await trash.listPageTrash(other.project.id)).toEqual([]);
    await trash.purgePageTrashItem(f.project.id, deleted.trashId);
    expect(await trash.listPageTrash(f.project.id)).toEqual([]);
  });

  it('drops a deleted account’s comments from Trash so a restore cannot bring them back', async () => {
    const f = await fixture();
    const leaving = await person();
    await db.prisma.comment.create({ data: { projectId: f.project.id, pageId: f.setup.id, userId: leaving.id, body: 'Personal note' } });
    const kept = await db.prisma.comment.create({ data: { projectId: f.project.id, pageId: f.setup.id, userId: f.author.id, body: 'Stays' } });
    const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
    await accountDeletion.eraseUserFromPageTrash(leaving.id);
    const row = await db.prisma.pageTrash.findUniqueOrThrow({ where: { id: deleted.trashId } });
    expect(JSON.stringify(row.payload)).not.toContain('Personal note');
    expect(JSON.stringify(row.payload)).toContain('Stays');
    await db.prisma.user.delete({ where: { id: leaving.id } });
    await trash.restorePageTrashItem(f.project.id, deleted.trashId);
    expect(await db.prisma.comment.findMany({ where: { pageId: f.setup.id }, select: { id: true } })).toEqual([{ id: kept.id }]);
  });

  describe('erasure leaves no Trash behind', () => {
    /** A real org with an owner and two websites, each with a page in Trash. */
    const orgFixture = async () => {
      const owner = await person();
      const org = await orgs.createOrganization(owner.id, `Trash ${randomUUID().slice(0, 8)}`);
      organizationIds.push(org.id);
      const sites: Array<{ site: { id: string }; trashId: string }> = [];
      for (const label of ['A', 'B']) {
        const site = await projects.createProject(owner.id, { name: `${label} ${randomUUID().slice(0, 8)}`, organizationId: org.id });
        const page = await pages.createPage(site.id, { title: `Doomed ${label}`, content: 'Private draft' });
        const deleted = await trash.deletePage(site.id, page.id, owner.id);
        sites.push({ site, trashId: deleted.trashId });
      }
      const name = (await db.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).name;
      return { owner, org, name, sites };
    };
    const trashLeft = (projectIds: string[]) => db.prisma.pageTrash.count({ where: { projectId: { in: projectIds } } });

    it('tenant erasure of one website', async () => {
      const f = await orgFixture();
      const [first, second] = f.sites;
      if (!first || !second) throw new Error('fixture');
      expect(await trashLeft([first.site.id])).toBe(1);
      await erasure.eraseProject(first.site.id);
      expect(await trashLeft([first.site.id])).toBe(0);
      expect(await trashLeft([second.site.id])).toBe(1);
    });

    it('tenant erasure of an organization', async () => {
      const f = await orgFixture();
      await erasure.eraseOrganization(f.org.id);
      expect(await trashLeft(f.sites.map((entry) => entry.site.id))).toBe(0);
    });

    it('deleting a website from its settings', async () => {
      const f = await orgFixture();
      const [first] = f.sites;
      if (!first) throw new Error('fixture');
      await projects.deleteProject(f.owner.id, f.org.id, first.site.id);
      expect(await trashLeft([first.site.id])).toBe(0);
      expect(await db.prisma.pageTrash.count({ where: { id: first.trashId } })).toBe(0);
    });

    it('deleting the organization through its manifest', async () => {
      const f = await orgFixture();
      await orgs.deleteOrganization(f.org.id, f.owner.id, f.name);
      expect(await db.prisma.organization.count({ where: { id: f.org.id } })).toBe(0);
      expect(await trashLeft(f.sites.map((entry) => entry.site.id))).toBe(0);
    });
  });
});
