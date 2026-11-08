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
  let app: Hono<HonoEnv>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    sites = await import('@/actions/sites');
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
    await db.prisma.member.create({ data: { organizationId: organization.id, userId: user.id, role: 'member' } });
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

  it('pauses an address for a day after three codes in a row ran out of guesses', async () => {
    const { project, readerEmail } = await site('READERS');
    await pastCodes(project.id, readerEmail, [
      { minutesAgo: 60, attempts: 5 },
      { minutesAgo: 120, attempts: 5 },
      { minutesAgo: 180, attempts: 5 },
    ]);
    expect(await startAnswer(project.id, readerEmail)).toEqual({ status: 200, body: { data: { sent: true } } });
    await noCodeSent();
    // Once the newest of the three was not burned, the address isn't paused.
    await db.prisma.siteSignInCode.updateMany({
      where: { projectId: project.id, email: readerEmail, createdAt: { gt: new Date(Date.now() - 90 * 60_000) } },
      data: { attempts: 2 },
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

  it('keeps the pause for a day after the third burned code, even when the first is older than a day', async () => {
    const { project, readerEmail } = await site('READERS');
    await pastCodes(project.id, readerEmail, [
      { minutesAgo: 60, attempts: 5 },
      { minutesAgo: 20 * 60, attempts: 5 },
      { minutesAgo: 30 * 60, attempts: 5 },
    ]);
    expect(await startAnswer(project.id, readerEmail)).toEqual({ status: 200, body: { data: { sent: true } } });
    await noCodeSent();
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

  it('burns a code after five wrong guesses, even when they arrive at once', async () => {
    const { project, readerEmail } = await site('READERS');
    await post(`sign-in/${project.id}/start`, { email: readerEmail });
    const code = await nextCode();
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    const guesses = await Promise.all(Array.from({ length: 8 }, () => post(`sign-in/${project.id}/verify`, { email: readerEmail, code: wrong })));
    expect(guesses.map((response) => response.status)).toEqual(new Array(8).fill(400));
    const row = await db.prisma.siteSignInCode.findFirstOrThrow({ where: { projectId: project.id } });
    expect(row.attempts).toBe(5);
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

  it('shows a visitor who cannot read a private site its name and branding, and nothing from its pages', async () => {
    const { project } = await site('READERS');
    const response = await app.request(`/api/public/sites/${project.id}/page?path=guide`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { details: unknown } };
    expect(body.error.details).toMatchObject({ reason: 'private', gate: { projectId: project.id, name: project.name, mode: 'READERS' } });
    expect(JSON.stringify(body)).not.toContain('Confidential guide');
  });
});
