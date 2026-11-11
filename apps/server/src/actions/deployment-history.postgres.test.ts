import { randomUUID } from 'node:crypto';
import { MemberRole } from '@nibleaf/shared/constants';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

/**
 * The publish history (AUTH-13) against PostgreSQL, through the real
 * deployments routes and guards: who may read it and restore from it, the
 * cursor pages, the live marker, and the bounded per-version change summary
 * computed from the snapshots in SQL. Every fixture is synthetic and cleanup
 * is restricted to the IDs this suite creates.
 */
vi.mock('@nibleaf/bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/bullmq')>()),
  createJob: vi.fn(async () => undefined),
}));
vi.mock('./platform-events', () => ({ logPlatformEvent: vi.fn() }));

describe.skipIf(process.env.PUBLISH_HISTORY_INTEGRATION !== '1')('publish history in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let history: typeof import('./deployment-history');
  let app: Hono<HonoEnv>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    history = await import('./deployment-history');
    const { errorMiddleware } = await import('@/errors/handler');
    const deployments = (await import('@/modules/app/deployments/handlers')).default;
    app = new Hono<HonoEnv>();
    app.use(contextStorage());
    app.use(async (ctx, next) => {
      const id = ctx.req.header('x-test-user');
      ctx.set('user', id ? { id, email: `${id}@nibleaf.test`, name: id, image: null } : null);
      ctx.set('session', null);
      ctx.set('organizationId', null as never);
      ctx.set('membership', null);
      ctx.set('apiKey', null);
      ctx.set('project', null);
      await next();
    });
    app.route('/api/app/projects/:projectId/deployments', deployments);
    app.onError((error, ctx) => errorMiddleware({ isDevelopment: false })(error, ctx));
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

  const person = async (label: string) => {
    const user = await db.prisma.user.create({
      data: { email: `${label}-${randomUUID()}@nibleaf.test`, name: `Fictional ${label}`, emailVerified: true },
    });
    userIds.push(user.id);
    return user;
  };

  /** A site in its own organization with an owner, an Editor and a Viewer. */
  const site = async () => {
    const id = `history-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id, slug: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: id, slug: id } });
    const team = {} as Record<'owner' | 'editor' | 'viewer', { id: string; name: string | null }>;
    for (const [key, role] of [
      ['owner', MemberRole.OWNER],
      ['editor', MemberRole.MEMBER],
      ['viewer', MemberRole.VIEWER],
    ] as const) {
      const user = await person(key);
      await db.prisma.member.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: role === 'owner' ? 'owner' : 'viewer',
          orgRole: role === 'owner' ? 'owner' : 'member',
        },
      });
      if (role !== 'owner')
        await db.prisma.projectMember.create({ data: { organizationId: organization.id, projectId: project.id, userId: user.id, role } });
      team[key] = { id: user.id, name: user.name };
    }
    return { organization, project, team };
  };

  type Page = { id: string; title: string; path: string; content: string; languageCode?: string; kind?: 'PAGE' | 'GROUP'; updatedAt?: string };
  const snapshot = (projectId: string, pages: Page[], config: Record<string, unknown> = {}) => ({
    project: { id: projectId, name: 'Docs', slug: 'docs', description: null, icon: null, config, languages: [], versions: [] },
    pages: pages.map((page, position) => ({
      parentId: null,
      versionId: 'main',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: page.updatedAt ?? '2026-01-01T00:00:00.000Z',
      languageCode: page.languageCode ?? 'en',
      kind: page.kind ?? 'PAGE',
      slug: page.path,
      icon: null,
      description: null,
      config: null,
      translationKey: null,
      position,
      hidden: false,
      ...page,
    })),
    openapi: null,
    generatedAt: new Date().toISOString(),
  });

  const deployment = (
    projectId: string,
    version: number,
    status: 'PENDING' | 'BUILDING' | 'READY' | 'FAILED',
    extra: { snapshot?: unknown; createdById?: string; commitMessage?: string; pagesCount?: number } = {},
  ) =>
    db.prisma.deployment.create({
      data: {
        projectId,
        version,
        status,
        pagesCount: extra.pagesCount ?? 0,
        createdById: extra.createdById ?? null,
        commitMessage: extra.commitMessage ?? null,
        snapshot: (extra.snapshot ?? (status === 'READY' ? snapshot(projectId, []) : undefined)) as never,
        completedAt: status === 'READY' || status === 'FAILED' ? new Date() : null,
      },
    });

  const call = async (userId: string, path: string, method = 'GET') => {
    const response = await app.request(`/api/app/projects/${path}`, { method, headers: { 'x-test-user': userId } });
    return { status: response.status, body: (await response.json()) as { data?: never; error?: { code: string } } };
  };

  it('lets a Viewer read the history and a version, stops them at Restore, and hides the site from an outsider', async () => {
    const { project, team } = await site();
    const v1 = await deployment(project.id, 1, 'READY', { createdById: team.editor.id, commitMessage: 'First' });
    await deployment(project.id, 2, 'READY', { createdById: team.editor.id });
    const outsider = await person('outsider');

    const list = await call(team.viewer.id, `${project.id}/deployments/history`);
    expect(list.status).toBe(200);
    expect(list.body.data).toMatchObject({
      live: { version: 2 },
      items: [{ version: 2 }, { version: 1, commitMessage: 'First', publishedBy: team.editor.name }],
    });
    expect((await call(team.viewer.id, `${project.id}/deployments/history/${v1.id}`)).status).toBe(200);

    const denied = await call(team.viewer.id, `${project.id}/deployments/${v1.id}/rollback`, 'POST');
    expect(denied).toMatchObject({ status: 403, body: { error: { code: 'auth:insufficient_role' } } });

    for (const [path, method] of [
      [`${project.id}/deployments/history`, 'GET'],
      [`${project.id}/deployments/history/${v1.id}`, 'GET'],
      [`${project.id}/deployments/${v1.id}/rollback`, 'POST'],
    ] as const) {
      expect((await call(outsider.id, path, method)).status).toBe(404);
    }
    expect(await db.prisma.deployment.count({ where: { projectId: project.id } })).toBe(2);

    // An Editor restores: a new version republishes v1's snapshot.
    const restored = await call(team.editor.id, `${project.id}/deployments/${v1.id}/rollback`, 'POST');
    expect(restored).toMatchObject({ status: 201, body: { data: { version: 3, status: 'PENDING', commitMessage: 'Rollback to v1' } } });
  });

  it('pages the history by version, newest first, without gaps or repeats, and marks the newest READY as live', async () => {
    const { project, team } = await site();
    for (let version = 1; version <= 25; version++) {
      // v18 is the last to go live; every attempt after it failed or is still running.
      const status = version <= 18 ? (version % 5 === 0 ? 'FAILED' : 'READY') : version === 25 ? 'BUILDING' : 'FAILED';
      await deployment(project.id, version, status, { createdById: version === 7 ? undefined : team.editor.id });
    }
    const first = await call(team.viewer.id, `${project.id}/deployments/history`);
    const firstPage = first.body.data as unknown as Awaited<ReturnType<typeof history.listPublishHistory>>;
    expect(firstPage.items.map((item) => item.version)).toEqual(Array.from({ length: 20 }, (_, i) => 25 - i));
    expect(firstPage.nextCursor).toBe(6);
    expect(firstPage.live).toMatchObject({ version: 18 });
    expect(firstPage.items[0]).toMatchObject({ status: 'BUILDING', publishedBy: team.editor.name });

    // A publish that lands while paging back does not shift the next page.
    await deployment(project.id, 26, 'READY');
    const second = (await call(team.viewer.id, `${project.id}/deployments/history?cursor=${firstPage.nextCursor}`)).body
      .data as unknown as typeof firstPage;
    expect(second.items.map((item) => item.version)).toEqual([5, 4, 3, 2, 1]);
    expect(second.nextCursor).toBeNull();
    expect(second.live).toMatchObject({ version: 26 });
    expect(second.items.find((item) => item.version === 7)).toBeUndefined();
    expect(firstPage.items.find((item) => item.version === 7)?.publishedBy).toBeNull();

    expect((await call(team.viewer.id, `${project.id}/deployments/history?cursor=abc`)).status).toBe(422);
  });

  it('summarizes added, edited and removed pages and settings against the previous READY version, skipping failed attempts', async () => {
    const { project, team } = await site();
    const before = snapshot(project.id, [
      { id: 'same', title: 'Same', path: 'same', content: 'Unchanged' },
      { id: 'resaved', title: 'Resaved', path: 'resaved', content: 'Unchanged' },
      { id: 'edited', title: 'Edited', path: 'edited', content: 'Old' },
      { id: 'gone', title: 'Gone', path: 'gone', content: 'Bye' },
    ]);
    const after = snapshot(
      project.id,
      [
        { id: 'same', title: 'Same', path: 'same', content: 'Unchanged' },
        // Saved again with nothing changed: only its timestamp moved.
        { id: 'resaved', title: 'Resaved', path: 'resaved', content: 'Unchanged', updatedAt: '2026-02-02T00:00:00.000Z' },
        { id: 'edited', title: 'Edited', path: 'edited', content: 'New' },
        { id: 'new', title: 'Brand new', path: 'guides/new', content: 'Hi', languageCode: 'ar' },
      ],
      { theme: 'dark' },
    );
    const v1 = await deployment(project.id, 1, 'READY', { snapshot: before });
    await deployment(project.id, 2, 'FAILED');
    const v3 = await deployment(project.id, 3, 'READY', { snapshot: after });
    const failed = await deployment(project.id, 4, 'FAILED');

    const detail = (await call(team.viewer.id, `${project.id}/deployments/history/${v3.id}`)).body.data as unknown as Awaited<
      ReturnType<typeof history.getPublishHistoryDetail>
    >;
    expect(detail.live).toMatchObject({ id: v3.id });
    expect(detail.summary).toEqual({
      previous: { id: v1.id, version: 1 },
      totals: { added: 1, modified: 1, removed: 1 },
      changes: [
        { id: 'new', title: 'Brand new', path: 'guides/new', languageCode: 'ar', kind: 'PAGE', status: 'added' },
        { id: 'edited', title: 'Edited', path: 'edited', languageCode: 'en', kind: 'PAGE', status: 'modified' },
        { id: 'gone', title: 'Gone', path: 'gone', languageCode: 'en', kind: 'PAGE', status: 'removed' },
      ],
      truncated: false,
      settingsChanged: true,
    });
    expect(JSON.stringify(detail)).not.toContain('Unchanged');

    // The first publish lists every page as new and has nothing to compare settings with.
    const first = await history.summarizePublishChanges(project.id, v1.id);
    expect(first).toMatchObject({ previous: null, totals: { added: 4, modified: 0, removed: 0 }, settingsChanged: false });

    // A failed attempt has no snapshot to compare.
    const failedDetail = (await call(team.viewer.id, `${project.id}/deployments/history/${failed.id}`)).body.data as unknown as typeof detail;
    expect(failedDetail).toMatchObject({ deployment: { status: 'FAILED', version: 4 }, summary: null });
  });

  it('caps the listed changes and still counts every one, per kind', async () => {
    const { project, team } = await site();
    const page = (id: string): Page => ({ id, title: `Page ${id}`, path: `p/${id}`, content: `Body ${id}` });
    const removedIds = Array.from({ length: 12 }, (_, i) => `r${String(i).padStart(3, '0')}`);
    const addedIds = Array.from({ length: 260 }, (_, i) => `a${String(i).padStart(3, '0')}`);
    await deployment(project.id, 1, 'READY', { snapshot: snapshot(project.id, removedIds.map(page)) });
    const v2 = await deployment(project.id, 2, 'READY', { snapshot: snapshot(project.id, addedIds.map(page)) });
    const summary = (await call(team.viewer.id, `${project.id}/deployments/history/${v2.id}`)).body.data as unknown as Awaited<
      ReturnType<typeof history.getPublishHistoryDetail>
    >;
    expect(summary.summary?.changes).toHaveLength(history.HISTORY_CHANGES_LIMIT);
    expect(summary.summary?.changes.every((change) => change.status === 'added')).toBe(true);
    // The removed pages fall past the cap, yet are counted.
    expect(summary.summary?.totals).toEqual({ added: 260, modified: 0, removed: 12 });
    expect(summary.summary?.truncated).toBe(true);
  });

  it('scopes every read to the site in the path', async () => {
    const one = await site();
    const two = await site();
    const foreign = await deployment(two.project.id, 1, 'READY', {
      snapshot: snapshot(two.project.id, [{ id: 'x', title: 'X', path: 'x', content: 'X' }]),
    });
    await deployment(one.project.id, 1, 'READY');
    // Site two's version through site one's address, by a member of site one.
    expect((await call(one.team.viewer.id, `${one.project.id}/deployments/history/${foreign.id}`)).status).toBe(404);
    const listed = (await call(one.team.viewer.id, `${one.project.id}/deployments/history`)).body.data as unknown as {
      items: Array<{ id: string }>;
    };
    expect(listed.items.map((item) => item.id)).not.toContain(foreign.id);
    // A summary request naming another site's version compares nothing of it.
    const crossed = await history.summarizePublishChanges(one.project.id, foreign.id);
    expect(crossed.changes).toEqual([]);
  });
});
