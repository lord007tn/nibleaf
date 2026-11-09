import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Prisma } from '@nibleaf/database';
import type { SiteSnapshot } from '@nibleaf/shared/site';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

/**
 * Access matrix for published sites, against a migrated PostgreSQL database.
 *
 * Every published surface is requested by every kind of visitor under every
 * access mode, through the real public handlers, the real viewer resolution and
 * real reader sessions. A visitor who may not read the site gets the same
 * private, uncacheable 404 on every surface, with no page title in it.
 */

// A dashboard session is a better-auth cookie. Tests name the signed-in user in
// a header instead; everything after the session lookup is real.
vi.mock('@nibleaf/auth/server', () => ({
  auth: {
    api: {
      getSession: vi.fn(async ({ headers }: { headers: Headers }) => {
        const id = headers.get('x-test-user');
        return id ? { user: { id }, session: { id: `session-${id}` } } : null;
      }),
    },
  },
}));
vi.mock('@nibleaf/bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/bullmq')>()),
  createJob: vi.fn(async () => undefined),
}));
vi.mock('@nibleaf/storage', () => ({
  headObject: vi.fn(async () => ({ ContentType: 'image/png' })),
  getObjectStream: vi.fn(async () => Readable.from([Buffer.from('image-bytes')])),
}));

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const SECRET_TITLES = ['Secret onboarding guide', 'Internal pricing runbook'];

type Mode = 'PUBLIC' | 'WORKSPACE' | 'READERS';
type Viewer =
  | 'anonymous'
  | 'member'
  | 'member signed in on the site'
  | 'removed member signed in on the site'
  | 'outsider'
  | 'reader'
  | 'revoked reader'
  | 'other-site reader'
  | 'other-site reader cookie replay';

/** Who may read the published site in each mode. */
const allowed: Record<Mode, Viewer[]> = {
  PUBLIC: [
    'anonymous',
    'member',
    'member signed in on the site',
    'removed member signed in on the site',
    'outsider',
    'reader',
    'revoked reader',
    'other-site reader',
    'other-site reader cookie replay',
  ],
  // A member signed in with an email code reads like a dashboard member: the
  // only way in on a custom domain, where the dashboard cookie never arrives.
  WORKSPACE: ['member', 'member signed in on the site'],
  READERS: ['member', 'member signed in on the site', 'reader'],
};
const viewers = allowed.PUBLIC;
const modes: Mode[] = ['PUBLIC', 'WORKSPACE', 'READERS'];

describe.skipIf(process.env.PRIVATE_SITE_INTEGRATION !== '1')('published site access matrix in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let sites: typeof import('@/actions/sites');
  let readerAccess: typeof import('@/actions/reader-access');
  let app: Hono<HonoEnv>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const site = {} as {
    projectId: string;
    otherProjectId: string;
    assetKey: string;
    previewToken: string;
    headers: Record<Viewer, Record<string, string>>;
  };

  const cookieName = (projectId: string) => `nibleaf_reader_${projectId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const snapshot = (projectId: string, name: string, assetKey: string): SiteSnapshot => ({
    project: {
      id: projectId,
      name,
      slug: name,
      description: null,
      icon: null,
      config: null,
      languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
      versions: [{ id: `branch-${projectId}`, name: 'main', slug: 'main', isDefault: true }],
    },
    pages: SECRET_TITLES.map((title, position) => ({
      id: `${projectId}-page-${position}`,
      parentId: null,
      versionId: `branch-${projectId}`,
      updatedAt: '2026-11-01T00:00:00.000Z',
      languageCode: 'en',
      kind: 'PAGE' as const,
      title,
      slug: position === 0 ? 'guide' : 'runbook',
      path: position === 0 ? 'guide' : 'runbook',
      icon: null,
      description: `${title} description`,
      content: `# ${title}\n\nConfidential body for ${title}.\n\n![diagram](/api/public/assets/${assetKey})`,
      config: null,
      translationKey: null,
      position,
      hidden: false,
    })),
    generatedAt: '2026-11-01T00:00:00.000Z',
  });

  const createSite = async (label: string) => {
    const id = `private-matrix-${label}-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id, slug: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: id, slug: id } });
    const assetKey = `projects/${project.id}/assets/${randomUUID()}.png`;
    await db.prisma.asset.create({
      data: { projectId: project.id, key: assetKey, url: `/api/public/assets/${assetKey}`, contentType: 'image/png', size: 11 },
    });
    await db.prisma.deployment.create({
      data: {
        projectId: project.id,
        version: 1,
        status: 'READY',
        completedAt: new Date(),
        pagesCount: SECRET_TITLES.length,
        snapshot: snapshot(project.id, id, assetKey) as unknown as Prisma.InputJsonValue,
      },
    });
    const user = await db.prisma.user.create({ data: { email: `${id}@nibleaf.test`, name: label, emailVerified: true } });
    userIds.push(user.id);
    await db.prisma.member.create({ data: { organizationId: organization.id, userId: user.id, role: 'owner' } });
    const audience = await db.prisma.audience.create({
      data: { projectId: project.id, name: 'Everyone', grants: { create: [{ projectId: project.id, pageId: null, scopeKey: 'SITE' }] } },
    });
    return { project, organization, assetKey, memberId: user.id, audienceId: audience.id };
  };

  /** An active reader of the site with a live session; returns the session token. */
  const activeReader = async (projectId: string, audienceId: string) => {
    const token = randomBytes(32).toString('base64url');
    const reader = await db.prisma.reader.create({
      data: {
        projectId,
        email: `reader-${randomUUID()}@example.invalid`,
        status: 'ACTIVE',
        activatedAt: new Date(),
        audiences: { create: [{ audienceId }] },
      },
    });
    await db.prisma.readerSession.create({
      data: { projectId, readerId: reader.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return { readerId: reader.id, token };
  };

  /** A live session of a team member signed in on the site; returns its token. */
  const memberSiteSession = async (projectId: string, userId: string) => {
    const token = randomBytes(32).toString('base64url');
    await db.prisma.siteMemberSession.create({ data: { projectId, userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3_600_000) } });
    return token;
  };

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    sites = await import('@/actions/sites');
    readerAccess = await import('@/actions/reader-access');
    const { errorMiddleware } = await import('@/errors/handler');
    const { protectPrivateDeliveryFailureResponse } = await import('@/lib/delivery-cache');
    const siteHandlers = (await import('./sites/handlers')).default;
    const assetHandlers = (await import('./assets/handlers')).default;
    const gitHandlers = (await import('./git/handlers')).default;
    app = new Hono<HonoEnv>();
    app.use(contextStorage());
    app.route('/api/public/sites', siteHandlers);
    app.route('/api/public/assets', assetHandlers);
    app.route('/api/public/git', gitHandlers);
    app.onError((error, ctx) => protectPrivateDeliveryFailureResponse(ctx.req.path, errorMiddleware({ isDevelopment: false })(error, ctx)));

    const subject = await createSite('subject');
    const other = await createSite('other');
    const reader = await activeReader(subject.project.id, subject.audienceId);
    const revoked = await activeReader(subject.project.id, subject.audienceId);
    await readerAccess.revokeReader(subject.project.id, revoked.readerId, subject.memberId);
    const otherReader = await activeReader(other.project.id, other.audienceId);
    // Team members signed in on the site itself with an email code; the second
    // one is then removed from the team.
    const siteMember = await memberSiteSession(subject.project.id, subject.memberId);
    const removed = await db.prisma.user.create({ data: { email: `removed-${randomUUID()}@nibleaf.test`, name: 'removed', emailVerified: true } });
    userIds.push(removed.id);
    await db.prisma.member.create({ data: { organizationId: subject.organization.id, userId: removed.id, role: 'member' } });
    const removedSession = await memberSiteSession(subject.project.id, removed.id);
    await db.prisma.member.deleteMany({ where: { organizationId: subject.organization.id, userId: removed.id } });

    const connection = await db.prisma.gitConnection.create({
      data: { projectId: subject.project.id, repository: 'acme/docs', headBranch: 'nibleaf', createdById: subject.memberId },
    });
    const previewToken = randomBytes(24).toString('base64url');
    await db.prisma.gitPreview.create({
      data: {
        projectId: subject.project.id,
        connectionId: connection.id,
        token: previewToken,
        sourceSha: randomUUID().replaceAll('-', ''),
        status: 'READY',
        snapshot: snapshot(subject.project.id, 'draft', subject.assetKey) as unknown as Prisma.InputJsonValue,
      },
    });

    const subjectCookie = cookieName(subject.project.id);
    Object.assign(site, {
      projectId: subject.project.id,
      otherProjectId: other.project.id,
      assetKey: subject.assetKey,
      previewToken,
      headers: {
        anonymous: {},
        member: { 'x-test-user': subject.memberId },
        // Signed in to Nibleaf, but a member of another site only.
        'member signed in on the site': { cookie: `${subjectCookie}=${siteMember}` },
        'removed member signed in on the site': { cookie: `${subjectCookie}=${removedSession}` },
        outsider: { 'x-test-user': other.memberId },
        reader: { cookie: `${subjectCookie}=${reader.token}` },
        'revoked reader': { cookie: `${subjectCookie}=${revoked.token}` },
        // A reader of another site, with that site's own cookie.
        'other-site reader': { cookie: `${cookieName(other.project.id)}=${otherReader.token}` },
        // The same valid session token presented under this site's cookie name.
        'other-site reader cookie replay': { cookie: `${subjectCookie}=${otherReader.token}` },
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const setMode = async (mode: Mode) => {
    await db.prisma.project.update({ where: { id: site.projectId }, data: { accessMode: mode } });
    sites.invalidatePublishedSiteConfig(site.projectId);
  };

  const surfaces = (): Array<{ name: string; path: string; init?: RequestInit; readsContent: boolean }> => [
    { name: 'site shell', path: `/api/public/sites/${site.projectId}`, readsContent: true },
    { name: 'page', path: `/api/public/sites/${site.projectId}/page?path=guide`, readsContent: true },
    { name: 'search', path: `/api/public/sites/${site.projectId}/search?q=onboarding`, readsContent: true },
    { name: 'changelog', path: `/api/public/sites/${site.projectId}/changelog`, readsContent: false },
    { name: 'changelog feed', path: `/api/public/sites/${site.projectId}/changelog/rss.xml`, readsContent: false },
    { name: 'sitemap', path: `/api/public/sites/${site.projectId}/sitemap.xml`, readsContent: false },
    { name: 'robots', path: `/api/public/sites/${site.projectId}/robots.txt`, readsContent: false },
    // Machine-readable documents carry the pages to everyone who may read them (#398).
    { name: 'Markdown', path: `/api/public/sites/${site.projectId}/markdown?path=guide`, readsContent: true },
    { name: 'llms.txt', path: `/api/public/sites/${site.projectId}/llms.txt`, readsContent: true },
    { name: 'llms-full.txt', path: `/api/public/sites/${site.projectId}/llms-full.txt`, readsContent: true },
    { name: 'asset', path: `/api/public/assets/${site.assetKey}`, readsContent: false },
  ];

  const request = (path: string, viewer: Viewer, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { 'user-agent': 'Mozilla/5.0 (matrix)', ...site.headers[viewer], ...(init.headers ?? {}) } });

  describe.each(modes)('%s site', (mode) => {
    beforeAll(() => setMode(mode));

    it.each(viewers)('serves or hides every published surface consistently for: %s', async (viewer) => {
      const mayRead = allowed[mode].includes(viewer);
      for (const surface of surfaces()) {
        const response = await request(surface.path, viewer, surface.init);
        const body = await response.text();
        const label = `${mode} / ${viewer} / ${surface.name}`;
        if (mayRead) {
          expect(response.status, label).toBe(200);
          if (surface.readsContent) expect(body, label).toContain(SECRET_TITLES[0]);
        } else {
          expect(response.status, label).toBe(404);
          for (const title of SECRET_TITLES) expect(body, label).not.toContain(title);
        }
        if (mode !== 'PUBLIC' || !mayRead) {
          // Responses that depend on who is asking must never enter a shared cache.
          expect(response.headers.get('cache-control'), label).toBe('private, no-store');
        }
      }
    });

    it.each(viewers)('gives Ask AI and chat the same scope as the site for: %s', async (viewer) => {
      const mayRead = allowed[mode].includes(viewer);
      const probe = new Hono<HonoEnv>();
      probe.use(contextStorage());
      probe.get('/', async (ctx) => {
        const context = await sites.resolvePublishedAnswerContext(site.projectId);
        return ctx.json({ pages: context.versionPages.map((page) => page.title) });
      });
      probe.onError((_error, ctx) => ctx.json({ denied: true }, 404));
      const response = await probe.request('/', { headers: site.headers[viewer] });
      expect(response.status).toBe(mayRead ? 200 : 404);
      if (mayRead) expect(await response.json()).toEqual({ pages: SECRET_TITLES });
    });

    it.each(viewers)('opens pull request previews (unpublished drafts) only to members unless the site is public, for: %s', async (viewer) => {
      const response = await request(`/api/public/git/previews/${site.previewToken}`, viewer);
      const mayPreview = mode === 'PUBLIC' || viewer === 'member';
      expect(response.status).toBe(mayPreview ? 200 : 404);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const body = await response.text();
      if (!mayPreview) for (const title of SECRET_TITLES) expect(body).not.toContain(title);
    });
  });

  it('stops serving a site the moment it is switched to private', async () => {
    await setMode('PUBLIC');
    expect((await request(`/api/public/sites/${site.projectId}/page?path=guide`, 'anonymous')).status).toBe(200);
    await setMode('WORKSPACE');
    expect((await request(`/api/public/sites/${site.projectId}/page?path=guide`, 'anonymous')).status).toBe(404);
  });

  it('lets the sign-in screen show the private site’s configured logo, and no other asset', async () => {
    const logoKey = `projects/${site.projectId}/assets/${randomUUID()}.png`;
    await db.prisma.asset.create({
      data: { projectId: site.projectId, key: logoKey, url: `/api/public/assets/${logoKey}`, contentType: 'image/png', size: 11 },
    });
    await db.prisma.project.update({
      where: { id: site.projectId },
      data: { config: { branding: { logoLight: `https://docs.example.invalid/api/public/assets/${logoKey}` } }, accessMode: 'READERS' },
    });
    sites.invalidatePublishedSiteConfig(site.projectId);
    const logo = await request(`/api/public/assets/${logoKey}`, 'anonymous');
    expect(logo.status).toBe(200);
    expect(logo.headers.get('cache-control')).toBe('private, no-store');
    expect((await request(`/api/public/assets/${site.assetKey}`, 'anonymous')).status).toBe(404);
    // Once it is no longer the configured logo, it is private again.
    await db.prisma.project.update({ where: { id: site.projectId }, data: { config: {} } });
    sites.invalidatePublishedSiteConfig(site.projectId);
    expect((await request(`/api/public/assets/${logoKey}`, 'anonymous')).status).toBe(404);
  });

  it('gives a page-scoped reader the Markdown and llms documents of exactly their pages', async () => {
    await setMode('READERS');
    // Real page rows under the snapshot's page ids, so a grant can name one.
    const language = await db.prisma.language.create({ data: { projectId: site.projectId, code: 'en', label: 'English' } });
    const branch = await db.prisma.branch.create({ data: { projectId: site.projectId, name: 'main', isDefault: true } });
    for (const [position, title] of SECRET_TITLES.entries()) {
      await db.prisma.page.create({
        data: {
          id: `${site.projectId}-page-${position}`,
          projectId: site.projectId,
          languageId: language.id,
          branchId: branch.id,
          title,
          slug: position === 0 ? 'guide' : 'runbook',
          path: position === 0 ? 'guide' : 'runbook',
          position,
        },
      });
    }
    const guideId = `${site.projectId}-page-0`;
    const group = await db.prisma.audience.create({
      data: {
        projectId: site.projectId,
        name: `Guide only ${randomUUID()}`,
        grants: { create: [{ projectId: site.projectId, pageId: guideId, scopeKey: `PAGE:${guideId}` }] },
      },
    });
    const scoped = await activeReader(site.projectId, group.id);
    const headers = { cookie: `${cookieName(site.projectId)}=${scoped.token}` };
    const get = async (path: string) => {
      const response = await app.request(`/api/public/sites/${site.projectId}${path}`, { headers });
      return { status: response.status, body: await response.text(), cache: response.headers.get('cache-control') };
    };

    const guide = await get('/markdown?path=guide');
    expect(guide.status).toBe(200);
    expect(guide.body).toContain(SECRET_TITLES[0]);
    expect(guide.cache).toBe('private, no-store');
    const runbook = await get('/markdown?path=runbook');
    expect(runbook.status).toBe(404);
    expect(runbook.body).not.toContain(SECRET_TITLES[1]);
    for (const file of ['/llms.txt', '/llms-full.txt']) {
      const document = await get(file);
      expect(document.status, file).toBe(200);
      expect(document.body, file).toContain(SECRET_TITLES[0]);
      expect(document.body, file).not.toContain(SECRET_TITLES[1]);
      expect(document.cache, file).toBe('private, no-store');
    }
    // A site-wide reader of the same site still gets both pages.
    const everyone = await db.prisma.audience.findFirstOrThrow({ where: { projectId: site.projectId, name: 'Everyone' } });
    const wide = await activeReader(site.projectId, everyone.id);
    const full = await app.request(`/api/public/sites/${site.projectId}/llms-full.txt`, {
      headers: { cookie: `${cookieName(site.projectId)}=${wide.token}` },
    });
    const fullBody = await full.text();
    for (const title of SECRET_TITLES) expect(fullBody).toContain(title);
  });

  it('does not tell an anonymous visitor which pages exist on a private site', async () => {
    await setMode('READERS');
    const existing = await request(`/api/public/sites/${site.projectId}/page?path=guide`, 'anonymous');
    const missing = await request(`/api/public/sites/${site.projectId}/page?path=no-such-page`, 'anonymous');
    expect(existing.status).toBe(missing.status);
    expect(await existing.json()).toEqual(await missing.json());
  });
});
