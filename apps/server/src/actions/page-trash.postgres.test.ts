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
  let history: typeof import('./page-history');
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
    history = await import('./page-history');
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

  it('purges expired items only when Trash is written to: delete, restore, delete forever', async () => {
    const f = await fixture();
    const expire = (id: string) => db.prisma.pageTrash.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const a = await trash.deletePage(f.project.id, f.intro.id, f.author.id);
    await expire(a.trashId);
    // Listing hides it but leaves it in place.
    expect(await trash.listPageTrash(f.project.id)).toEqual([]);
    expect(await db.prisma.pageTrash.count({ where: { id: a.trashId } })).toBe(1);
    const z = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
    expect(await db.prisma.pageTrash.count({ where: { id: a.trashId } })).toBe(0);
    await trash.restorePageTrashItem(f.project.id, z.trashId);

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

  it('counts without purging: the footer count is a plain read', async () => {
    const f = await fixture();
    const kept = await trash.deletePage(f.project.id, f.intro.id, f.author.id);
    const expired = await trash.deletePage(f.project.id, f.last.id, f.author.id);
    await db.prisma.pageTrash.update({ where: { id: expired.trashId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const deleteMany = vi.spyOn(db.prisma.pageTrash, 'deleteMany');
    try {
      expect(await trash.countPageTrash(f.project.id)).toEqual({ count: 1 });
      expect(await trash.countPageTrash(f.project.id, f.branch.id)).toEqual({ count: 1 });
      expect(deleteMany).not.toHaveBeenCalled();
    } finally {
      deleteMany.mockRestore();
    }
    expect(await db.prisma.pageTrash.count({ where: { id: { in: [kept.trashId, expired.trashId] } } })).toBe(2);
  });

  it('lists without writing: a viewer-reachable GET never deletes', async () => {
    const f = await fixture();
    const kept = await trash.deletePage(f.project.id, f.intro.id, f.author.id);
    const expired = await trash.deletePage(f.project.id, f.last.id, f.author.id);
    await db.prisma.pageTrash.update({ where: { id: expired.trashId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const deleteMany = vi.spyOn(db.prisma.pageTrash, 'deleteMany');
    try {
      expect((await trash.listPageTrash(f.project.id)).map((row) => row.id)).toEqual([kept.trashId]);
      expect((await trash.listPageTrash(f.project.id, f.branch.id)).map((row) => row.id)).toEqual([kept.trashId]);
      expect(deleteMany).not.toHaveBeenCalled();
    } finally {
      deleteMany.mockRestore();
    }
    expect(await db.prisma.pageTrash.count({ where: { id: { in: [kept.trashId, expired.trashId] } } })).toBe(2);
  });

  it('refuses a subtree whose payload is over the cap, deleting nothing', async () => {
    const f = await fixture();
    await expect(trash.deletePage(f.project.id, f.guide.id, f.author.id, { maxPayloadBytes: 512 })).rejects.toMatchObject({
      code: 'page:trash_too_large',
      status: 413,
      details: { reason: 'page_trash_too_large', limit: 512 },
    });
    expect(await db.prisma.page.count({ where: { id: { in: [f.guide.id, f.setup.id, f.deep.id, f.usage.id] } } })).toBe(4);
    expect(await db.prisma.pageTrash.count({ where: { projectId: f.project.id } })).toBe(0);
    // Under the default cap the same delete goes through.
    expect(trash.PAGE_TRASH_MAX_PAYLOAD_BYTES).toBe(25 * 1024 * 1024);
    await expect(trash.deletePage(f.project.id, f.guide.id, f.author.id)).resolves.toMatchObject({ pageCount: 4 });
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

  describe('account erasure and trash writes stay consistent', () => {
    /** A page with one comment by a member who will leave and one by the author. */
    const commented = async () => {
      const f = await fixture();
      const leaving = await person();
      await db.prisma.comment.create({ data: { projectId: f.project.id, pageId: f.setup.id, userId: leaving.id, body: 'Leaving note' } });
      const kept = await db.prisma.comment.create({ data: { projectId: f.project.id, pageId: f.setup.id, userId: f.author.id, body: 'Stays' } });
      return { f, leaving, kept };
    };
    const payloadOf = async (trashId: string) => JSON.stringify((await db.prisma.pageTrash.findUniqueOrThrow({ where: { id: trashId } })).payload);
    const restoredComments = async (f: Awaited<ReturnType<typeof fixture>>, trashId: string) => {
      await trash.restorePageTrashItem(f.project.id, trashId);
      return db.prisma.comment.findMany({ where: { pageId: f.setup.id }, select: { id: true } });
    };

    it('removes an account’s comments from existing Trash in the account delete itself', async () => {
      const { f, leaving, kept } = await commented();
      const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
      expect(await payloadOf(deleted.trashId)).toContain('Leaving note');
      await db.prisma.user.delete({ where: { id: leaving.id } });
      expect(await payloadOf(deleted.trashId)).not.toContain('Leaving note');
      expect(await payloadOf(deleted.trashId)).toContain('Stays');
      expect(await restoredComments(f, deleted.trashId)).toEqual([{ id: kept.id }]);
    });

    it('does not copy comments of an account deleted while the page was being moved to Trash', async () => {
      const { f, leaving, kept } = await commented();
      // The account delete commits after the trash write read the comments.
      const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id, {
        afterCommentsRead: async () => {
          await db.prisma.user.delete({ where: { id: leaving.id } });
        },
      });
      expect(await payloadOf(deleted.trashId)).not.toContain('Leaving note');
      expect(await restoredComments(f, deleted.trashId)).toEqual([{ id: kept.id }]);
    });

    it('makes an account delete wait for a trash write that holds its comments, then removes them', async () => {
      const { f, leaving, kept } = await commented();
      let accountDelete: Promise<unknown> | undefined;
      let waited = false;
      const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id, {
        afterAuthorsLocked: async () => {
          accountDelete = db.prisma.user.delete({ where: { id: leaving.id } });
          const settled = await Promise.race([accountDelete.then(() => 'done'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 500))]);
          waited = settled === 'waiting';
        },
      });
      expect(waited).toBe(true);
      await accountDelete;
      expect(await db.prisma.user.count({ where: { id: leaving.id } })).toBe(0);
      expect(await payloadOf(deleted.trashId)).not.toContain('Leaving note');
      expect(await payloadOf(deleted.trashId)).toContain('Stays');
      expect(await restoredComments(f, deleted.trashId)).toEqual([{ id: kept.id }]);
    });
  });

  describe('page history goes to Trash and comes back (#492)', () => {
    /** Revisions oldest first, a day apart, with `size` bytes of content each. */
    const addRevisions = async (f: Awaited<ReturnType<typeof fixture>>, pageId: string, authors: Array<string | null>, size = 10, firstDay = 1) => {
      const rows: Array<Awaited<ReturnType<typeof db.prisma.pageRevision.create>>> = [];
      for (const [index, userId] of authors.entries()) {
        rows.push(
          await db.prisma.pageRevision.create({
            data: {
              projectId: f.project.id,
              pageId,
              userId,
              title: `Rev ${firstDay + index}`,
              content: `${'x'.repeat(size)}${index}`,
              contentBytes: size,
              reason: index === 0 ? 'before-restore' : 'autosave',
              createdAt: new Date(Date.UTC(2026, 9, firstDay + index)),
            },
          }),
        );
      }
      return rows;
    };
    const revisionsOf = (pageIds: string[]) =>
      db.prisma.pageRevision.findMany({
        where: { pageId: { in: pageIds } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, pageId: true, userId: true, createdAt: true, reason: true, title: true, content: true },
      });
    const payloadOf = async (trashId: string) =>
      (await db.prisma.pageTrash.findUniqueOrThrow({ where: { id: trashId } })).payload as {
        schemaVersion: number;
        revisions: Array<{ id: string; userId: string | null; content: string }>;
        revisionCounts: Record<string, { total: number; kept: number }>;
      };
    const listed = (projectId: string, pageId: string) => history.listPageHistory(projectId, pageId, { source: 'revision' });

    it('restores the same revisions, authors and times, with no notice', async () => {
      const f = await fixture();
      const other = await person();
      const before = [...(await addRevisions(f, f.setup.id, [f.author.id, other.id, null])), ...(await addRevisions(f, f.deep.id, [f.author.id]))];
      const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
      // Gone from the live table with the pages; carried in the payload.
      expect(await revisionsOf([f.setup.id, f.deep.id])).toEqual([]);
      const payload = await payloadOf(deleted.trashId);
      expect(payload.schemaVersion).toBe(trash.PAGE_TRASH_SCHEMA_VERSION);
      expect(payload.revisions).toHaveLength(4);
      expect(payload.revisionCounts).toEqual({ [f.setup.id]: { total: 3, kept: 3 }, [f.deep.id]: { total: 1, kept: 1 } });
      await trash.restorePageTrashItem(f.project.id, deleted.trashId);
      const after = await revisionsOf([f.setup.id, f.deep.id]);
      const shape = (rows: typeof after) =>
        rows.map(({ id, pageId, userId, createdAt, reason, title, content }) => ({
          id,
          pageId,
          userId,
          at: createdAt.toISOString(),
          reason,
          title,
          content,
        }));
      expect(shape(after)).toEqual(shape(before.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))));
      const list = await listed(f.project.id, f.setup.id);
      expect(list.entries.map((entry) => entry.id)).toEqual(
        before
          .filter((row) => row.pageId === f.setup.id)
          .map((row) => row.id)
          .reverse(),
      );
      expect(list.entries.map((entry) => entry.author)).toEqual([null, 'Synthetic author', 'Synthetic author']);
      expect(list.trimmedFromTrash).toBeNull();
      expect((await db.prisma.page.findUniqueOrThrow({ where: { id: f.setup.id } })).historyTrimmedFromTrash).toBeNull();
    });

    it('drops the oldest revisions to fit the cap, keeps the newest, and records the notice', async () => {
      const f = await fixture();
      await addRevisions(f, f.setup.id, [f.author.id, f.author.id, f.author.id], 4000, 1);
      const newest = await addRevisions(f, f.deep.id, [f.author.id, f.author.id], 4000, 10);
      // Measure the full payload, then delete again with room for the two newest only.
      const probe = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
      const full = await payloadOf(probe.trashId);
      const fullBytes = Buffer.byteLength(JSON.stringify(full), 'utf8');
      const sizeOf = (index: number) => Buffer.byteLength(JSON.stringify(full.revisions[index]), 'utf8') + 1;
      await trash.restorePageTrashItem(f.project.id, probe.trashId);
      const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id, {
        maxPayloadBytes: fullBytes - sizeOf(0) - sizeOf(1) - sizeOf(2),
      });
      const payload = await payloadOf(deleted.trashId);
      expect(payload.revisions.map((revision) => revision.id)).toEqual(newest.map((row) => row.id));
      expect(payload.revisionCounts).toEqual({ [f.setup.id]: { total: 3, kept: 0 }, [f.deep.id]: { total: 2, kept: 2 } });
      await trash.restorePageTrashItem(f.project.id, deleted.trashId);
      expect((await revisionsOf([f.setup.id, f.deep.id])).map((row) => row.id)).toEqual(newest.map((row) => row.id));
      const notice = (await listed(f.project.id, f.setup.id)).trimmedFromTrash;
      expect(notice).toMatchObject({ kept: 0, total: 3 });
      expect(Number.isNaN(Date.parse(notice?.at ?? ''))).toBe(false);
      expect((await listed(f.project.id, f.deep.id)).trimmedFromTrash).toBeNull();
      // Moving the page to Trash again clears the notice; this restore keeps everything.
      const again = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
      await trash.restorePageTrashItem(f.project.id, again.trashId);
      expect((await listed(f.project.id, f.setup.id)).trimmedFromTrash).toBeNull();
    });

    it('still refuses when the pages alone are over the cap', async () => {
      const f = await fixture();
      await addRevisions(f, f.setup.id, [f.author.id], 2000);
      await expect(trash.deletePage(f.project.id, f.setup.id, f.author.id, { maxPayloadBytes: 300 })).rejects.toMatchObject({
        code: 'page:trash_too_large',
      });
      expect((await revisionsOf([f.setup.id])).length).toBe(1);
    });

    it('restores an older payload without history', async () => {
      const f = await fixture();
      await addRevisions(f, f.setup.id, [f.author.id]);
      const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
      const { revisions: _revisions, revisionCounts: _counts, ...rest } = await payloadOf(deleted.trashId);
      await db.prisma.pageTrash.update({ where: { id: deleted.trashId }, data: { payload: { ...rest, schemaVersion: 1 } as never } });
      await expect(trash.restorePageTrashItem(f.project.id, deleted.trashId)).resolves.toMatchObject({ page: { id: f.setup.id } });
      expect(await revisionsOf([f.setup.id])).toEqual([]);
      expect((await listed(f.project.id, f.setup.id)).trimmedFromTrash).toBeNull();
    });

    it('forgets the author of a revision whose account is deleted while the page is in Trash', async () => {
      const f = await fixture();
      const leaving = await person();
      const [byLeaving, byAuthor] = await addRevisions(f, f.setup.id, [leaving.id, f.author.id]);
      const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
      expect(JSON.stringify(await payloadOf(deleted.trashId))).toContain(leaving.id);
      await db.prisma.user.delete({ where: { id: leaving.id } });
      const payload = await payloadOf(deleted.trashId);
      expect(JSON.stringify(payload)).not.toContain(leaving.id);
      expect(payload.revisions.map((revision) => revision.userId)).toEqual([null, f.author.id]);
      await trash.restorePageTrashItem(f.project.id, deleted.trashId);
      expect((await revisionsOf([f.setup.id])).map((row) => [row.id, row.userId])).toEqual([
        [byLeaving?.id, null],
        [byAuthor?.id, f.author.id],
      ]);
    });

    it('does not carry a revision author deleted while the page was being moved to Trash', async () => {
      const f = await fixture();
      const leaving = await person();
      await addRevisions(f, f.setup.id, [leaving.id]);
      const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id, {
        afterCommentsRead: async () => {
          // The page row lock does not stop the account delete; its SET NULL waits on nothing here.
          await db.prisma.user.delete({ where: { id: leaving.id } });
        },
      });
      expect(JSON.stringify(await payloadOf(deleted.trashId))).not.toContain(leaving.id);
      await trash.restorePageTrashItem(f.project.id, deleted.trashId);
      expect((await revisionsOf([f.setup.id])).map((row) => row.userId)).toEqual([null]);
    });

    it('makes an account delete wait for the trash write that holds its revisions, then forgets the author', async () => {
      const f = await fixture();
      const leaving = await person();
      await addRevisions(f, f.setup.id, [leaving.id]);
      let accountDelete: Promise<unknown> | undefined;
      let waited = false;
      const deleted = await trash.deletePage(f.project.id, f.setup.id, f.author.id, {
        afterAuthorsLocked: async () => {
          accountDelete = db.prisma.user.delete({ where: { id: leaving.id } });
          const settled = await Promise.race([accountDelete.then(() => 'done'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 500))]);
          waited = settled === 'waiting';
        },
      });
      expect(waited).toBe(true);
      await accountDelete;
      expect(JSON.stringify(await payloadOf(deleted.trashId))).not.toContain(leaving.id);
      await trash.restorePageTrashItem(f.project.id, deleted.trashId);
      expect((await revisionsOf([f.setup.id])).map((row) => row.userId)).toEqual([null]);
    });

    it('leaves no history behind after delete forever or expiry', async () => {
      const f = await fixture();
      await addRevisions(f, f.setup.id, [f.author.id, f.author.id]);
      await addRevisions(f, f.last.id, [f.author.id]);
      const forever = await trash.deletePage(f.project.id, f.setup.id, f.author.id);
      await trash.purgePageTrashItem(f.project.id, forever.trashId);
      expect(await db.prisma.pageTrash.count({ where: { id: forever.trashId } })).toBe(0);
      const expiring = await trash.deletePage(f.project.id, f.last.id, f.author.id);
      await db.prisma.pageTrash.update({ where: { id: expiring.trashId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await trash.deletePage(f.project.id, f.intro.id, f.author.id);
      expect(await db.prisma.pageTrash.count({ where: { id: expiring.trashId } })).toBe(0);
      expect(await revisionsOf([f.setup.id, f.deep.id, f.last.id])).toEqual([]);
    });
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
        await db.prisma.pageRevision.create({
          data: {
            projectId: site.id,
            pageId: page.id,
            userId: owner.id,
            title: 'Old',
            content: 'Private history',
            contentBytes: 18,
            reason: 'autosave',
          },
        });
        const deleted = await trash.deletePage(site.id, page.id, owner.id);
        sites.push({ site, trashId: deleted.trashId });
      }
      const name = (await db.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).name;
      return { owner, org, name, sites };
    };
    const trashLeft = async (projectIds: string[]) =>
      (await db.prisma.pageTrash.count({ where: { projectId: { in: projectIds } } })) +
      (await db.prisma.pageRevision.count({ where: { projectId: { in: projectIds } } }));

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
