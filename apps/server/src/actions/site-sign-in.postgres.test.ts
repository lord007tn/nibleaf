import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '@nibleaf/database';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

/**
 * Email-code sign-in on private published sites, against PostgreSQL, through
 * the real public handlers. Codes are captured where the email would be
 * rendered; everything else (eligibility, hashing, attempts, sessions,
 * revocation and membership checks) is real.
 */
const sent = vi.hoisted(() => [] as Array<{ code: string; projectName: string }>);
const failures = vi.hoisted(() => ({ renderEmail: 0 }));
vi.mock('@nibleaf/auth/server', () => ({ auth: { api: { getSession: vi.fn(async () => null) } } }));
vi.mock('@nibleaf/bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/bullmq')>()),
  createJob: vi.fn(async () => undefined),
}));
vi.mock('@nibleaf/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/email')>()),
  renderSiteSignInCodeEmail: vi.fn(async (input: { code: string; projectName: string }) => {
    if (failures.renderEmail > 0) {
      failures.renderEmail -= 1;
      throw new Error('email rendering is down');
    }
    sent.push(input);
    return { subject: 'code', html: '', text: '' };
  }),
}));

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe.skipIf(process.env.PRIVATE_SITE_INTEGRATION !== '1')('site email-code sign-in in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let sites: typeof import('@/actions/sites');
  let readerAccess: typeof import('@/actions/reader-access');
  let app: Hono<HonoEnv>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    sites = await import('@/actions/sites');
    readerAccess = await import('@/actions/reader-access');
    const { errorMiddleware } = await import('@/errors/handler');
    app = new Hono<HonoEnv>();
    app.use(contextStorage());
    app.route('/api/public/reader-access', (await import('@/modules/public/reader-access/handlers')).default);
    app.route('/api/public/sites', (await import('@/modules/public/sites/handlers')).default);
    app.onError((error, ctx) => errorMiddleware({ isDevelopment: false })(error, ctx));
  }, 120_000);

  beforeEach(() => {
    sent.length = 0;
  });

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

  /** A published site in `mode` with a member, an invited reader and a site-wide audience. */
  const site = async (mode: 'PUBLIC' | 'WORKSPACE' | 'READERS') => {
    const id = `sign-in-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id, slug: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: `Docs ${id}`, slug: id, accessMode: mode } });
    await db.prisma.deployment.create({
      data: {
        projectId: project.id,
        version: 1,
        status: 'READY',
        completedAt: new Date(),
        pagesCount: 1,
        snapshot: {
          project: {
            id: project.id,
            name: project.name,
            slug: id,
            description: null,
            icon: null,
            config: null,
            languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
            versions: [{ id: 'main', name: 'main', slug: 'main', isDefault: true }],
          },
          pages: [
            {
              id: `${project.id}-guide`,
              parentId: null,
              versionId: 'main',
              updatedAt: '2026-11-01T00:00:00.000Z',
              languageCode: 'en',
              kind: 'PAGE',
              title: 'Confidential guide',
              slug: 'guide',
              path: 'guide',
              icon: null,
              description: null,
              content: '# Confidential guide',
              config: null,
              translationKey: null,
              position: 0,
              hidden: false,
            },
          ],
          generatedAt: '2026-11-01T00:00:00.000Z',
        } as unknown as Prisma.InputJsonValue,
      },
    });
    const memberEmail = `member-${randomUUID()}@nibleaf.test`;
    const user = await db.prisma.user.create({ data: { email: memberEmail, name: 'Member', emailVerified: true } });
    userIds.push(user.id);
    await db.prisma.member.create({ data: { organizationId: organization.id, userId: user.id, role: 'viewer', orgRole: 'member' } });
    await db.prisma.projectMember.create({ data: { organizationId: organization.id, projectId: project.id, userId: user.id, role: 'member' } });
    const audience = await db.prisma.audience.create({
      data: { projectId: project.id, name: 'Everyone', grants: { create: [{ projectId: project.id, pageId: null, scopeKey: 'SITE' }] } },
    });
    const readerEmail = `reader-${randomUUID()}@example.invalid`;
    const reader = await db.prisma.reader.create({
      data: { projectId: project.id, email: readerEmail, audiences: { create: [{ audienceId: audience.id }] } },
    });
    sites.invalidatePublishedSiteConfig(project.id);
    return { project, organization, user, memberEmail, reader, readerEmail, audience };
  };

  const post = (path: string, body: unknown, cookie?: string) =>
    app.request(`/api/public/reader-access/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  /** The code is issued after the response; wait for it to be captured. */
  const nextCode = async () => {
    for (let i = 0; i < 100 && sent.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    const code = sent.shift()?.code;
    if (!code) throw new Error('no code was sent');
    return code;
  };
  const signIn = async (projectId: string, email: string) => {
    expect((await post(`sign-in/${projectId}/start`, { email })).status).toBe(200);
    const code = await nextCode();
    const response = await post(`sign-in/${projectId}/verify`, { email, code });
    return {
      response,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
    };
  };
  const readPage = (projectId: string, cookie: string) =>
    app.request(`/api/public/sites/${projectId}/page?path=guide`, { headers: cookie ? { cookie } : {} });

  it('signs an invited reader in, activates them and opens the site', async () => {
    const { project, reader, readerEmail } = await site('READERS');
    const { response, cookie } = await signIn(project.id, readerEmail.toUpperCase());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(cookie).toMatch(/^nibleaf_reader_/);
    expect((await readPage(project.id, cookie)).status).toBe(200);
    const after = await db.prisma.reader.findUniqueOrThrow({ where: { id: reader.id } });
    expect(after).toMatchObject({ status: 'ACTIVE' });
    expect(after.activatedAt).not.toBeNull();
    const shell = (await (await app.request(`/api/public/sites/${project.id}`, { headers: { cookie } })).json()) as { data: { signedIn?: boolean } };
    expect(shell.data.signedIn).toBe(true);
  });

  it('signs a team member in on the site in both private modes, and only while they stay a member', async () => {
    for (const mode of ['WORKSPACE', 'READERS'] as const) {
      const { project, organization, user, memberEmail } = await site(mode);
      const { response, cookie } = await signIn(project.id, memberEmail);
      expect(response.status, mode).toBe(200);
      expect((await readPage(project.id, cookie)).status, mode).toBe(200);
      await db.prisma.member.deleteMany({ where: { organizationId: organization.id, userId: user.id } });
      expect((await readPage(project.id, cookie)).status, mode).toBe(404);
    }
  });

  it('answers every address the same and sends a code only to those who may read the site', async () => {
    const { project, readerEmail, memberEmail } = await site('WORKSPACE');
    const other = await site('READERS');
    const answers = await Promise.all(
      [
        readerEmail, // a reader, but this site is Team only
        `stranger-${randomUUID()}@example.invalid`,
        other.memberEmail, // a member of another site
      ].map(async (email) => {
        const response = await post(`sign-in/${project.id}/start`, { email });
        return { status: response.status, body: await response.json() };
      }),
    );
    for (const answer of answers) expect(answer).toEqual({ status: 200, body: { data: { sent: true } } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent).toEqual([]);
    expect(await db.prisma.siteSignInCode.count({ where: { projectId: project.id } })).toBe(0);
    await post(`sign-in/${project.id}/start`, { email: memberEmail });
    await nextCode();
  });

  /** Codes sent earlier, each `minutesAgo` old (all outside the 15-minute window unless set otherwise). */
  const pastCodes = (projectId: string, email: string, codes: Array<{ minutesAgo: number; attempts?: number }>) =>
    db.prisma.siteSignInCode.createMany({
      data: codes.map(({ minutesAgo, attempts = 0 }) => {
        const createdAt = new Date(Date.now() - minutesAgo * 60_000);
        return { projectId, email, codeHash: 'spent', attempts, createdAt, expiresAt: new Date(createdAt.getTime() + 10 * 60_000) };
      }),
    });
  const startAnswer = async (projectId: string, email: string) => {
    const response = await post(`sign-in/${projectId}/start`, { email });
    return { status: response.status, body: await response.json() };
  };
  const noCodeSent = async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent).toEqual([]);
  };

  it('sends one address at most 10 codes a day, and answers the same when the cap is reached', async () => {
    const { project, readerEmail } = await site('READERS');
    await pastCodes(
      project.id,
      readerEmail,
      Array.from({ length: 10 }, (_, index) => ({ minutesAgo: 30 + index * 150 })),
    );
    expect(await startAnswer(project.id, readerEmail)).toEqual({ status: 200, body: { data: { sent: true } } });
    await noCodeSent();
    expect(await db.prisma.siteSignInCode.count({ where: { projectId: project.id, email: readerEmail } })).toBe(10);
    // Once the oldest code is more than a day old, the address gets one again.
    await db.prisma.siteSignInCode.updateMany({
      where: { projectId: project.id, email: readerEmail, createdAt: { lt: new Date(Date.now() - 22 * 60 * 60_000) } },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60_000) },
    });
    expect(await startAnswer(project.id, readerEmail)).toEqual({ status: 200, body: { data: { sent: true } } });
    await nextCode();
  });

  it('never exceeds the budget when many requests arrive at once, without queueing them on a lock', async () => {
    const { project, readerEmail } = await site('READERS');
    const answers = await Promise.all(Array.from({ length: 20 }, () => startAnswer(project.id, readerEmail)));
    for (const answer of answers) expect(answer).toEqual({ status: 200, body: { data: { sent: true } } });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // Requests that find another issuance in progress send nothing instead of waiting.
    const issued = await db.prisma.siteSignInCode.count({ where: { projectId: project.id, email: readerEmail } });
    expect(issued).toBeGreaterThanOrEqual(1);
    expect(issued).toBeLessThanOrEqual(5);
    expect(sent).toHaveLength(issued);
  });

  /** Ask for a code and use up its five guesses with wrong answers. */
  const burnCode = async (projectId: string, email: string) => {
    await post(`sign-in/${projectId}/start`, { email });
    const code = await nextCode();
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    for (let i = 0; i < 5; i++) expect((await post(`sign-in/${projectId}/verify`, { email, code: wrong })).status).toBe(400);
  };

  it('pauses an address for a day from the moment its third burned code runs out of guesses', async () => {
    const { project, readerEmail } = await site('READERS');
    await burnCode(project.id, readerEmail);
    await burnCode(project.id, readerEmail);
    // Two burned codes don't pause the address.
    expect(
      (await db.prisma.siteSignInGuard.findUnique({ where: { projectId_email: { projectId: project.id, email: readerEmail } } }))?.pausedUntil ??
        null,
    ).toBeNull();
    const before = Date.now();
    await burnCode(project.id, readerEmail);
    const paused = await db.prisma.siteSignInGuard.findUnique({ where: { projectId_email: { projectId: project.id, email: readerEmail } } });
    expect(paused?.pausedUntil?.getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60_000);
    expect(await startAnswer(project.id, readerEmail)).toEqual({ status: 200, body: { data: { sent: true } } });
    await noCodeSent();
    // Cleaning up every code (as the hourly cleanup eventually does) doesn't end it.
    await db.prisma.siteSignInCode.deleteMany({ where: { projectId: project.id, email: readerEmail } });
    expect(await startAnswer(project.id, readerEmail)).toEqual({ status: 200, body: { data: { sent: true } } });
    await noCodeSent();
    // Once the pause ends, the address gets a code again.
    await db.prisma.siteSignInGuard.update({
      where: { projectId_email: { projectId: project.id, email: readerEmail } },
      data: { pausedUntil: new Date(Date.now() - 1000) },
    });
    expect(await startAnswer(project.id, readerEmail)).toEqual({ status: 200, body: { data: { sent: true } } });
    await nextCode();
  });

  it('still pauses when the earlier burned codes were cleaned up before the third ran out', async () => {
    const { project, readerEmail } = await site('READERS');
    await burnCode(project.id, readerEmail);
    await burnCode(project.id, readerEmail);
    await db.prisma.siteSignInCode.deleteMany({ where: { projectId: project.id, email: readerEmail } });
    await burnCode(project.id, readerEmail);
    expect(
      (
        await db.prisma.siteSignInGuard.findUnique({ where: { projectId_email: { projectId: project.id, email: readerEmail } } })
      )?.pausedUntil?.getTime() ?? 0,
    ).toBeGreaterThan(Date.now());
  });

  it('keeps an unfinished streak through cleanup, so the next burned code still starts the pause', async () => {
    const { project, readerEmail, memberEmail } = await site('READERS');
    const idle = `idle-${randomUUID()}@example.invalid`;
    await db.prisma.siteSignInGuard.createMany({
      data: [
        { projectId: project.id, email: readerEmail, burnedCodes: 2 },
        { projectId: project.id, email: idle, burnedCodes: 0 },
      ],
    });
    // Both guards untouched for ten days.
    await db.prisma.$executeRaw`UPDATE "site_sign_in_guard" SET "updatedAt" = now() - interval '10 days' WHERE "projectId" = ${project.id}`;
    // Issuing a code for any address runs the cleanup.
    await post(`sign-in/${project.id}/start`, { email: memberEmail });
    await nextCode();
    const idleGuard = () => db.prisma.siteSignInGuard.findUnique({ where: { projectId_email: { projectId: project.id, email: idle } } });
    for (let i = 0; i < 50 && (await idleGuard()); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await idleGuard()).toBeNull();
    expect(
      (await db.prisma.siteSignInGuard.findUnique({ where: { projectId_email: { projectId: project.id, email: readerEmail } } }))?.burnedCodes,
    ).toBe(2);
    await burnCode(project.id, readerEmail);
    const guard = await db.prisma.siteSignInGuard.findUnique({ where: { projectId_email: { projectId: project.id, email: readerEmail } } });
    expect(guard?.pausedUntil?.getTime() ?? 0).toBeGreaterThan(Date.now() + 23 * 60 * 60_000);
  });

  it('starts the streak over after a successful sign-in', async () => {
    const { project, readerEmail } = await site('READERS');
    await burnCode(project.id, readerEmail);
    await burnCode(project.id, readerEmail);
    await signIn(project.id, readerEmail);
    expect(
      (await db.prisma.siteSignInGuard.findUnique({ where: { projectId_email: { projectId: project.id, email: readerEmail } } }))?.burnedCodes,
    ).toBe(0);
    await burnCode(project.id, readerEmail);
    expect(
      (await db.prisma.siteSignInGuard.findUnique({ where: { projectId_email: { projectId: project.id, email: readerEmail } } }))?.pausedUntil ??
        null,
    ).toBeNull();
  });

  it('never issues a code between the guess that burns the third code and the pause it starts', async () => {
    const { project, readerEmail } = await site('READERS');
    await burnCode(project.id, readerEmail);
    await burnCode(project.id, readerEmail);
    await post(`sign-in/${project.id}/start`, { email: readerEmail });
    const code = await nextCode();
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    for (let i = 0; i < 4; i++) await post(`sign-in/${project.id}/verify`, { email: readerEmail, code: wrong });
    // The fifth wrong guess and a new start race.
    await Promise.all([
      post(`sign-in/${project.id}/verify`, { email: readerEmail, code: wrong }),
      post(`sign-in/${project.id}/start`, { email: readerEmail }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const state = await db.prisma.siteSignInGuard.findUnique({ where: { projectId_email: { projectId: project.id, email: readerEmail } } });
    const codes = await db.prisma.siteSignInCode.findMany({ where: { projectId: project.id, email: readerEmail }, orderBy: { createdAt: 'desc' } });
    if (state?.pausedUntil) {
      // The guess won: the third code burned, the pause started, and no code followed it.
      expect(codes[0]?.attempts).toBe(5);
    } else {
      // The start won: a new code exists, and the fifth guess was never counted against the old one.
      expect(codes[1]?.attempts).toBe(4);
      expect(codes[0]?.attempts).toBeLessThanOrEqual(1);
    }
  });

  it('accepts only the newest code, so an earlier code stays dead after the newest is used', async () => {
    const { project, readerEmail } = await site('READERS');
    await post(`sign-in/${project.id}/start`, { email: readerEmail });
    const first = await nextCode();
    // Outside the 15-minute window only matters for timing; a second code now.
    await post(`sign-in/${project.id}/start`, { email: readerEmail });
    const second = await nextCode();
    expect((await post(`sign-in/${project.id}/verify`, { email: readerEmail, code: first })).status).toBe(400);
    expect((await post(`sign-in/${project.id}/verify`, { email: readerEmail, code: second })).status).toBe(200);
    expect((await post(`sign-in/${project.id}/verify`, { email: readerEmail, code: first })).status).toBe(400);
  });

  it('does not count a code that could not be sent, and tells the email worker when the code expires', async () => {
    const { project, readerEmail } = await site('READERS');
    const { createJob } = await import('@nibleaf/bullmq');
    vi.mocked(createJob).mockClear();
    failures.renderEmail = 1;
    await post(`sign-in/${project.id}/start`, { email: readerEmail });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await db.prisma.siteSignInCode.count({ where: { projectId: project.id, email: readerEmail } })).toBe(0);
    await post(`sign-in/${project.id}/start`, { email: readerEmail });
    await nextCode();
    const row = await db.prisma.siteSignInCode.findFirstOrThrow({ where: { projectId: project.id, email: readerEmail } });
    expect(vi.mocked(createJob)).toHaveBeenCalledWith('email', {
      name: 'send-email',
      data: expect.objectContaining({ to: readerEmail, auth: { purpose: 'otp', expiresAt: row.expiresAt.getTime() } }),
    });
  });

  it('keeps a code counted when queueing its email failed in a way that may still deliver it', async () => {
    const { project, readerEmail } = await site('READERS');
    const { createJob } = await import('@nibleaf/bullmq');
    vi.mocked(createJob).mockRejectedValueOnce(new Error('Redis reply timed out after the job was written'));
    await post(`sign-in/${project.id}/start`, { email: readerEmail });
    await nextCode();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await db.prisma.siteSignInCode.count({ where: { projectId: project.id, email: readerEmail } })).toBe(1);
  });

  it('does not let a suspended team member in as an invited reader under the same address', async () => {
    const { project, user, memberEmail, audience } = await site('READERS');
    await db.prisma.reader.create({ data: { projectId: project.id, email: memberEmail, audiences: { create: [{ audienceId: audience.id }] } } });
    await post(`sign-in/${project.id}/start`, { email: memberEmail });
    const code = await nextCode();
    await db.prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });
    expect((await post(`sign-in/${project.id}/verify`, { email: memberEmail, code })).status).toBe(400);
    expect(await db.prisma.readerSession.count({ where: { projectId: project.id } })).toBe(0);
    expect(await startAnswer(project.id, memberEmail)).toEqual({ status: 200, body: { data: { sent: true } } });
    await noCodeSent();
  });

  it('gives a suspended team member no code and ends their existing site session', async () => {
    const { project, user, memberEmail } = await site('WORKSPACE');
    const { cookie } = await signIn(project.id, memberEmail);
    expect((await readPage(project.id, cookie)).status).toBe(200);
    await db.prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });
    expect((await readPage(project.id, cookie)).status).toBe(404);
    expect(await startAnswer(project.id, memberEmail)).toEqual({ status: 200, body: { data: { sent: true } } });
    await noCodeSent();
  });

  it('refuses a code when the team member was suspended after it was sent', async () => {
    const { project, user, memberEmail } = await site('READERS');
    await post(`sign-in/${project.id}/start`, { email: memberEmail });
    const code = await nextCode();
    await db.prisma.user.update({ where: { id: user.id }, data: { banned: true } });
    const response = await post(`sign-in/${project.id}/verify`, { email: memberEmail, code });
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await db.prisma.siteMemberSession.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('never sends a code for a public site', async () => {
    const { project, memberEmail } = await site('PUBLIC');
    expect((await post(`sign-in/${project.id}/start`, { email: memberEmail })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent).toEqual([]);
  });

  it('stores only a salted hash of the code', async () => {
    const { project, readerEmail } = await site('READERS');
    await post(`sign-in/${project.id}/start`, { email: readerEmail });
    const code = await nextCode();
    const row = await db.prisma.siteSignInCode.findFirstOrThrow({ where: { projectId: project.id } });
    expect(row.codeHash).toBe(sha256(`${row.id}:${code}`));
    expect(row.codeHash).not.toContain(code);
  });

  it('never counts more than five guesses on a code, even when they arrive at once', async () => {
    const { project, readerEmail } = await site('READERS');
    await post(`sign-in/${project.id}/start`, { email: readerEmail });
    const code = await nextCode();
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    const guesses = await Promise.all(Array.from({ length: 8 }, () => post(`sign-in/${project.id}/verify`, { email: readerEmail, code: wrong })));
    expect(guesses.map((response) => response.status)).toEqual(new Array(8).fill(400));
    // Guesses that find another guess in progress are refused without being counted or checked.
    const counted = (await db.prisma.siteSignInCode.findFirstOrThrow({ where: { projectId: project.id } })).attempts;
    expect(counted).toBeGreaterThanOrEqual(1);
    expect(counted).toBeLessThanOrEqual(5);
    for (let i = counted; i < 5; i++) await post(`sign-in/${project.id}/verify`, { email: readerEmail, code: wrong });
    expect((await db.prisma.siteSignInCode.findFirstOrThrow({ where: { projectId: project.id } })).attempts).toBe(5);
    expect((await post(`sign-in/${project.id}/verify`, { email: readerEmail, code })).status).toBe(400);
  });

  it('accepts a code once', async () => {
    const { project, readerEmail } = await site('READERS');
    await post(`sign-in/${project.id}/start`, { email: readerEmail });
    const code = await nextCode();
    const [first, second] = await Promise.all([
      post(`sign-in/${project.id}/verify`, { email: readerEmail, code }),
      post(`sign-in/${project.id}/verify`, { email: readerEmail, code }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 400]);
  });

  it('refuses a code when the reader was revoked after it was sent', async () => {
    const { project, reader, readerEmail } = await site('READERS');
    await post(`sign-in/${project.id}/start`, { email: readerEmail });
    const code = await nextCode();
    await db.prisma.reader.update({ where: { id: reader.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
    const response = await post(`sign-in/${project.id}/verify`, { email: readerEmail, code });
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await db.prisma.readerSession.count({ where: { readerId: reader.id } })).toBe(0);
  });

  it('does not let a code for one site sign in to another', async () => {
    const first = await site('READERS');
    const second = await site('READERS');
    await db.prisma.reader.create({
      data: { projectId: second.project.id, email: first.readerEmail, audiences: { create: [{ audienceId: second.audience.id }] } },
    });
    await post(`sign-in/${first.project.id}/start`, { email: first.readerEmail });
    const code = await nextCode();
    expect((await post(`sign-in/${second.project.id}/verify`, { email: first.readerEmail, code })).status).toBe(400);
  });

  it('ends the session on sign-out for readers and members', async () => {
    const { project, readerEmail, memberEmail } = await site('READERS');
    for (const email of [readerEmail, memberEmail]) {
      const { cookie } = await signIn(project.id, email);
      expect((await post(`logout/${project.id}`, {}, cookie)).status).toBe(200);
      expect((await readPage(project.id, cookie)).status).toBe(404);
    }
  });

  it('opens an invitation link without using the invitation up, then accepts it once on a click', async () => {
    const { project, reader } = await site('READERS');
    const token = randomBytes(32).toString('base64url');
    await db.prisma.readerInvitation.create({
      data: {
        projectId: project.id,
        readerId: reader.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 3_600_000),
        createdById: 'test',
      },
    });
    for (let i = 0; i < 3; i++) {
      // Mail scanners and link previews open the link: no session, no use.
      const opened = await app.request(`/api/public/reader-access/activate?token=${token}`);
      expect(opened.status).toBe(303);
      expect(opened.headers.get('location')).toMatch(new RegExp(`/sites/${project.id}#reader-invite=${token}$`));
      expect(opened.headers.getSetCookie()).toEqual([]);
    }
    const accepted = await post('accept', { token });
    expect(accepted.status).toBe(200);
    const cookie = accepted.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    expect((await readPage(project.id, cookie)).status).toBe(200);
    expect((await post('accept', { token })).status).toBeGreaterThanOrEqual(400);
  });

  it('lets an address at an allowed domain sign in as a whole-site reader, and only on an Invited readers site', async () => {
    const { project, user } = await site('READERS');
    await readerAccess.setReaderEmailDomains(project.id, user.id, { domains: ['partner.example'] });
    const email = `ana-${randomUUID()}@partner.example`;
    const { response, cookie } = await signIn(project.id, email);
    expect(response.status).toBe(200);
    expect((await readPage(project.id, cookie)).status).toBe(200);
    const reader = await db.prisma.reader.findUniqueOrThrow({
      where: { projectId_email: { projectId: project.id, email } },
      include: { audiences: { include: { audience: { include: { grants: true } } } } },
    });
    expect(reader.status).toBe('ACTIVE');
    expect(reader.audiences.flatMap((item) => item.audience.grants.map((grant) => grant.scopeKey))).toEqual(['SITE']);
    // Other domains, and the same domain on a Team only site, get nothing.
    expect(await startAnswer(project.id, 'ana@other.example')).toEqual({ status: 200, body: { data: { sent: true } } });
    await noCodeSent();
    const team = await site('WORKSPACE');
    await readerAccess.setReaderEmailDomains(team.project.id, team.user.id, { domains: ['partner.example'] });
    expect(await startAnswer(team.project.id, email)).toEqual({ status: 200, body: { data: { sent: true } } });
    await noCodeSent();
  });

  it('keeps a revoked reader out even when their address is at an allowed domain', async () => {
    const { project, user, reader, readerEmail } = await site('READERS');
    await readerAccess.setReaderEmailDomains(project.id, user.id, { domains: [readerEmail.split('@')[1] as string] });
    await readerAccess.revokeReader(project.id, reader.id, user.id);
    expect(await startAnswer(project.id, readerEmail)).toEqual({ status: 200, body: { data: { sent: true } } });
    await noCodeSent();
  });

  it('stores allowed domains lowercased, without @, sorted and once each', async () => {
    const { project, user } = await site('READERS');
    expect(await readerAccess.setReaderEmailDomains(project.id, user.id, { domains: ['b.example', 'a.example', 'b.example'] })).toEqual({
      domains: ['a.example', 'b.example'],
    });
    const { readerEmailDomainsBody } = await import('@nibleaf/validators');
    expect(readerEmailDomainsBody.parse({ domains: ['@Partner.Example '] })).toEqual({ domains: ['partner.example'] });
    expect(readerEmailDomainsBody.safeParse({ domains: ['not a domain'] }).success).toBe(false);
  });

  it('invites readers to the whole site without setting up an audience, one or many at a time', async () => {
    const id = `fresh-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id, slug: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: id, slug: id, accessMode: 'READERS' } });
    const one = await readerAccess.inviteReader(project.id, 'owner', { email: `one-${randomUUID()}@example.invalid` });
    const many = await readerAccess.inviteReaders(project.id, 'owner', {
      emails: [`two-${randomUUID()}@example.invalid`, `three-${randomUUID()}@example.invalid`],
    });
    expect(many.invited).toBe(2);
    const audiences = await db.prisma.audience.findMany({ where: { projectId: project.id }, include: { grants: true, readers: true } });
    // One whole-site audience, created once and shared by every invite.
    expect(audiences).toHaveLength(1);
    expect(audiences[0]?.grants.map((grant) => grant.scopeKey)).toEqual(['SITE']);
    expect(audiences[0]?.readers.map((member) => member.readerId).sort()).toEqual([one.reader.id, ...many.readers.map((reader) => reader.id)].sort());
  });

  it('resends an invitation with a new link, keeps the reader’s access, and refuses revoked readers', async () => {
    const { project, user, readerEmail } = await site('READERS');
    const first = await readerAccess.inviteReader(project.id, user.id, { email: readerEmail });
    const resent = await readerAccess.resendReaderInvitation(project.id, first.reader.id, user.id);
    expect(resent.activationUrl).not.toBe(first.activationUrl);
    const invitations = await db.prisma.readerInvitation.findMany({ where: { readerId: first.reader.id }, orderBy: { createdAt: 'asc' } });
    expect(invitations.map((invitation) => invitation.revokedAt === null)).toEqual([false, true]);
    expect(await db.prisma.readerAudience.count({ where: { readerId: first.reader.id } })).toBe(1);
    await readerAccess.revokeReader(project.id, first.reader.id, user.id);
    await expect(readerAccess.resendReaderInvitation(project.id, first.reader.id, user.id)).rejects.toMatchObject({
      details: { reason: 'reader_revoked' },
    });
  });

  it('shows a visitor who cannot read a private site its name and branding, and nothing from its pages', async () => {
    const { project } = await site('READERS');
    const response = await app.request(`/api/public/sites/${project.id}/page?path=guide`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { details: unknown } };
    expect(body.error.details).toMatchObject({ reason: 'private', gate: { projectId: project.id, name: project.name, mode: 'READERS' } });
    expect(JSON.stringify(body)).not.toContain('Confidential guide');
  });
});
