import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

/**
 * Access requests from a private site's sign-in screen, against PostgreSQL,
 * through the real public handler. Every answer must be identical; only an
 * opted-in Invited readers site records a request from someone who can't sign
 * in yet, and only its Owners and Admins hear about it.
 */
const emails = vi.hoisted(() => [] as Array<{ to: string; subject: string }>);
vi.mock('@nibleaf/auth/server', () => ({ auth: { api: { getSession: vi.fn(async () => null) } } }));
vi.mock('@nibleaf/bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/bullmq')>()),
  createJob: vi.fn(async (_queue: string, job: { data: { to: string; subject: string } }) => {
    emails.push({ to: job.data.to, subject: job.data.subject });
  }),
}));

describe.skipIf(process.env.PRIVATE_SITE_INTEGRATION !== '1')('reader access requests in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let requests: typeof import('./reader-access-requests');
  let readerAccess: typeof import('./reader-access');
  let app: Hono<HonoEnv>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    requests = await import('./reader-access-requests');
    readerAccess = await import('./reader-access');
    const { errorMiddleware } = await import('@/errors/handler');
    app = new Hono<HonoEnv>();
    app.use(contextStorage());
    app.route('/api/public/reader-access', (await import('@/modules/public/reader-access/handlers')).default);
    app.onError((error, ctx) => errorMiddleware({ isDevelopment: false })(error, ctx));
  }, 120_000);

  beforeEach(() => {
    emails.length = 0;
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  /** A site with an owner, an admin, an editor and a viewer, plus one invited reader. */
  const site = async ({ mode = 'READERS', enabled = true }: { mode?: 'PUBLIC' | 'WORKSPACE' | 'READERS'; enabled?: boolean } = {}) => {
    const id = `requests-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id, slug: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({
      data: { organizationId: organization.id, name: `Docs ${id}`, slug: id, accessMode: mode, readerAccessRequests: enabled },
    });
    const team: Record<string, { id: string; email: string }> = {};
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      const user = await db.prisma.user.create({ data: { email: `${role}-${randomUUID()}@nibleaf.test`, name: role, emailVerified: true } });
      userIds.push(user.id);
      await db.prisma.member.create({ data: { organizationId: organization.id, userId: user.id, role } });
      team[role] = { id: user.id, email: user.email };
    }
    const reader = await readerAccess.inviteReader(project.id, team.owner?.id ?? 'owner', { email: `reader-${randomUUID()}@example.invalid` });
    emails.length = 0;
    return { project, team, reader: reader.reader };
  };

  const ask = async (projectId: string, email: string, extra: { name?: string; note?: string } = {}) => {
    const response = await app.request(`/api/public/reader-access/request/${projectId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, ...extra }),
    });
    return { status: response.status, body: await response.json() };
  };
  const RECEIVED = { status: 200, body: { data: { received: true } } };
  /** The work runs after the answer; give it time, then read the result. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
  const requestRows = (projectId: string) => db.prisma.readerAccessRequest.findMany({ where: { projectId } });
  const bell = (projectId: string) =>
    db.prisma.notification.findMany({ where: { projectId, type: 'access_request' }, select: { userId: true, params: true } });

  it('records a request and tells only the Owners and Admins, by bell and by email', async () => {
    const { project, team } = await site();
    expect(await ask(project.id, 'Kim@Example.com', { name: 'Kim', note: 'For the pilot' })).toEqual(RECEIVED);
    await settle();
    const [row] = await requestRows(project.id);
    expect(row).toMatchObject({ email: 'kim@example.com', name: 'Kim', note: 'For the pilot', status: 'PENDING' });
    const notified = (await bell(project.id)).map((item) => item.userId).sort();
    expect(notified).toEqual([team.owner?.id, team.admin?.id].sort());
    expect(emails.map((email) => email.to).sort()).toEqual([team.owner?.email, team.admin?.email].sort());
    expect(emails[0]?.subject).toContain('Kim (kim@example.com)');
  });

  it('writes to the Admins in the site’s default language, not the visitor’s', async () => {
    const { project } = await site();
    await db.prisma.language.create({ data: { projectId: project.id, code: 'ar', label: 'العربية', direction: 'RTL', isDefault: true } });
    await ask(project.id, 'kim@example.com');
    await settle();
    expect(emails).toHaveLength(2);
    expect(emails[0]?.subject).toContain('طلب قراءة');
  });

  it('answers the same and records nothing when the site does not take requests', async () => {
    const off = await site({ enabled: false });
    const team = await site({ mode: 'WORKSPACE' });
    const open = await site({ mode: 'PUBLIC' });
    for (const target of [off, team, open]) {
      expect(await ask(target.project.id, 'kim@example.com')).toEqual(RECEIVED);
    }
    await settle();
    for (const target of [off, team, open]) expect(await requestRows(target.project.id)).toEqual([]);
    expect(emails).toEqual([]);
  });

  it('answers the same and records nothing for people who can already sign in, or were revoked', async () => {
    const { project, team, reader } = await site();
    await readerAccess.setReaderEmailDomains(project.id, team.owner?.id ?? 'owner', { domains: ['partner.example'] });
    const revoked = await readerAccess.inviteReader(project.id, team.owner?.id ?? 'owner', { email: `gone-${randomUUID()}@example.invalid` });
    await readerAccess.revokeReader(project.id, revoked.reader.id, team.owner?.id ?? 'owner');
    emails.length = 0;
    for (const email of [reader.email as string, team.viewer?.email as string, 'ana@partner.example', revoked.reader.email as string]) {
      expect(await ask(project.id, email)).toEqual(RECEIVED);
    }
    await settle();
    expect(await requestRows(project.id)).toEqual([]);
    expect(emails).toEqual([]);
  });

  it('tells the Admins once per open request, and caps new requests per site and hour', async () => {
    const { project } = await site();
    await ask(project.id, 'kim@example.com');
    await settle();
    await ask(project.id, 'kim@example.com');
    await settle();
    expect(await requestRows(project.id)).toHaveLength(1);
    expect(await bell(project.id)).toHaveLength(2); // one request, owner + admin

    await db.prisma.readerAccessRequest.createMany({
      data: Array.from({ length: 19 }, (_, index) => ({ projectId: project.id, email: `flood-${index}@example.invalid` })),
    });
    expect(await ask(project.id, 'late@example.com')).toEqual(RECEIVED);
    await settle();
    expect(await db.prisma.readerAccessRequest.count({ where: { projectId: project.id, email: 'late@example.com' } })).toBe(0);
  });

  it('keeps a declined address quiet for 30 days, then lets it ask again', async () => {
    const { project, team } = await site();
    await ask(project.id, 'kim@example.com');
    await settle();
    const [request] = await requestRows(project.id);
    await requests.declineReaderAccessRequest(project.id, request?.id as string, team.admin?.id as string);
    emails.length = 0;
    await ask(project.id, 'kim@example.com');
    await settle();
    expect((await requestRows(project.id))[0]?.status).toBe('DECLINED');
    expect(emails).toEqual([]);
    await db.prisma.readerAccessRequest.update({
      where: { id: request?.id as string },
      data: { decidedAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) },
    });
    await ask(project.id, 'kim@example.com');
    await settle();
    expect((await requestRows(project.id))[0]?.status).toBe('PENDING');
    expect(emails).toHaveLength(2);
  });

  it('approves in one step by inviting the person to the whole site, and answers each request once', async () => {
    const { project, team } = await site();
    await ask(project.id, 'kim@example.com', { name: 'Kim' });
    await settle();
    const [request] = await requestRows(project.id);
    emails.length = 0;
    const approved = await requests.approveReaderAccessRequest(project.id, request?.id as string, team.admin?.id as string);
    const reader = await db.prisma.reader.findUniqueOrThrow({
      where: { id: approved.readerId },
      include: { audiences: { include: { audience: { include: { grants: true } } } } },
    });
    expect(reader).toMatchObject({ email: 'kim@example.com', name: 'Kim', status: 'INVITED' });
    expect(reader.audiences.flatMap((item) => item.audience.grants.map((grant) => grant.scopeKey))).toEqual(['SITE']);
    // The usual invitation email goes to the person.
    expect(emails.map((email) => email.to)).toEqual(['kim@example.com']);
    expect((await requestRows(project.id))[0]).toMatchObject({ status: 'APPROVED', decidedById: team.admin?.id });
    await expect(requests.approveReaderAccessRequest(project.id, request?.id as string, team.admin?.id as string)).rejects.toMatchObject({
      status: 409,
    });
    await expect(requests.declineReaderAccessRequest(project.id, 'no-such-request', team.admin?.id as string)).rejects.toMatchObject({ status: 404 });
  });

  it('does not let one site act on another site’s request', async () => {
    const first = await site();
    const second = await site();
    await ask(first.project.id, 'kim@example.com');
    await settle();
    const [request] = await requestRows(first.project.id);
    await expect(
      requests.approveReaderAccessRequest(second.project.id, request?.id as string, second.team.admin?.id as string),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});
