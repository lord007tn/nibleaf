import { createHmac, randomUUID } from 'node:crypto';
import { diffSchema, getExpectedSchema } from '@better-auth/core/db/internal';
import { prisma } from '@nibleaf/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { ADMIN_ORIGIN, APP_ORIGIN, AUTH_SECRET, GOOGLE_CLIENT_ID, mocks } = vi.hoisted(() => {
  const ADMIN_ORIGIN = 'https://admin.nibleaf.test';
  const APP_ORIGIN = 'https://app.nibleaf.test';
  const AUTH_SECRET = 'better-auth-postgres-integration-secret';
  const GOOGLE_CLIENT_ID = 'google-client-id';
  // `./server` reads these once on import.
  Object.assign(process.env, {
    BETTER_AUTH_SECRET: AUTH_SECRET,
    BETTER_AUTH_URL: APP_ORIGIN,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    TRUSTED_ORIGINS: `${APP_ORIGIN},${ADMIN_ORIGIN}`,
  });
  return {
    ADMIN_ORIGIN,
    APP_ORIGIN,
    AUTH_SECRET,
    GOOGLE_CLIENT_ID,
    mocks: { codes: new Map<string, string>(), emailsTo: [] as string[], googleIdToken: '' },
  };
});

vi.mock('@nibleaf/bullmq', () => ({
  createJob: vi.fn(async (_queue: string, job: { data?: { auth?: unknown; text?: string; to?: string } }) => {
    if (job.data?.to) {
      mocks.emailsTo.push(job.data.to);
    }
    if (job.data?.auth && job.data.to && job.data.text) {
      mocks.codes.set(job.data.to, job.data.text);
    }
  }),
  QueueNames: { EMAIL: 'email', PUBLISH: 'publish', SEARCH: 'search' },
}));
vi.mock('@nibleaf/clickhouse', () => ({
  clickHouseWritesEnabled: () => false,
  deleteProjectAnalytics: vi.fn(),
  deleteProjectUsage: vi.fn(),
  keys: () => ({ ANALYTICS_MODE: 'postgres' }),
}));
vi.mock('@nibleaf/email', () => {
  const rendered = async () => ({ html: '', subject: 'Synthetic', text: '' });
  return {
    createEmailTranslator: () => (key: string) => key,
    renderMemberJoinedEmail: rendered,
    renderNewSignInEmail: rendered,
    renderVerificationCodeEmail: async ({ code }: { code: string }) => ({ html: code, subject: 'Synthetic', text: code }),
    resolveEmailLanguage: () => 'en',
  };
});

const SESSION_COOKIE = '__Secure-better-auth.session_token';
const run = randomUUID();
const addressFor = (label: string) => `${label}-${run}@nibleaf.test`;

interface RequestOptions {
  body?: unknown;
  cookie?: string;
  origin?: string;
}

interface SessionBody {
  session: { impersonatedBy?: string | null };
  user: { email: string; id: string; role: string };
}

// Explicit opt-in: CI supplies its disposable migrated PostgreSQL service. The
// real auth instance runs against it; only email, queues, and Google are stubbed.
describe.skipIf(process.env.AUTH_INTEGRATION !== '1')('Better Auth on PostgreSQL', () => {
  let auth: typeof import('./server')['auth'];

  const send = (path: string, { body, cookie, origin }: RequestOptions = {}) => {
    const headers = new Headers();
    if (cookie) {
      headers.set('cookie', cookie);
    }
    if (body !== undefined) {
      headers.set('content-type', 'application/json');
    }
    if (origin || body !== undefined) {
      headers.set('origin', origin ?? APP_ORIGIN);
    }
    return auth.handler(
      new Request(`${APP_ORIGIN}/api/auth${path}`, {
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body), method: 'POST' }),
      }),
    );
  };

  const setCookiePairs = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(';', 1)[0]);

  const sessionCookie = (response: Response) => {
    // Impersonation clears the old cookie first; like a browser, the last one wins.
    const cookie = setCookiePairs(response).findLast((pair) => pair?.startsWith(`${SESSION_COOKIE}=`));
    expect(cookie, 'session cookie').toBeTruthy();
    return cookie as string;
  };

  const readSession = async (cookie: string, origin?: string) => {
    const response = await send('/get-session', { cookie, origin });
    expect(response.status).toBe(200);
    return (await response.json()) as SessionBody | null;
  };

  const signInWithCode = async (email: string, origin?: string) => {
    expect((await send('/email-otp/send-verification-otp', { body: { email, type: 'sign-in' }, origin })).status).toBe(200);
    const response = await send('/sign-in/email-otp', { body: { email, otp: mocks.codes.get(email) }, origin });
    expect(response.status).toBe(200);
    return response;
  };

  /** Runs the real social sign-in and callback; only Google's token endpoint is stubbed. */
  const signInWithGoogle = async (sub: string, email: string) => {
    const started = await send('/sign-in/social', { body: { callbackURL: '/app', provider: 'google' } });
    expect(started.status).toBe(200);
    const { url } = (await started.json()) as { url: string };
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const issuedAt = Math.floor(Date.now() / 1000);
    mocks.googleIdToken = [
      encode({ alg: 'RS256', typ: 'JWT' }),
      encode({
        aud: GOOGLE_CLIENT_ID,
        email,
        email_verified: true,
        exp: issuedAt + 3600,
        iat: issuedAt,
        iss: 'https://accounts.google.com',
        name: 'Synthetic Google User',
        sub,
      }),
      'unverified-test-signature',
    ].join('.');
    const state = new URL(url).searchParams.get('state') ?? '';
    return send(`/callback/google?code=synthetic-code&state=${encodeURIComponent(state)}`, { cookie: setCookiePairs(started).join('; ') });
  };

  const expectSignedInRedirect = (response: Response) => {
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/app');
  };

  const createGoogleUser = async (label: string, state: { banned?: boolean; suspendedAt?: Date } = {}) => {
    const email = addressFor(label);
    const sub = `${label}-${run}`;
    const user = await prisma.user.create({ data: { email, emailVerified: true, name: label, ...state } });
    await prisma.account.create({ data: { accountId: sub, providerId: 'google', userId: user.id } });
    return { email, sub, userId: user.id };
  };

  const signInAsOwner = async () => {
    const cookie = sessionCookie(await signInWithCode(addressFor(`owner-${randomUUID()}`)));
    const userId = (await readSession(cookie))?.user.id as string;
    const { organizationId } = await prisma.member.findFirstOrThrow({ where: { role: 'owner', userId } });
    return { cookie, organizationId, userId };
  };

  beforeAll(async () => {
    ({ auth } = await import('./server'));
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== 'https://oauth2.googleapis.com/token') {
        return realFetch(input, init);
      }
      return Promise.resolve(
        Response.json({
          access_token: 'synthetic-access-token',
          expires_in: 3600,
          id_token: mocks.googleIdToken,
          scope: 'openid email profile',
          token_type: 'Bearer',
        }),
      );
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await prisma.$disconnect();
  });

  it('passes Better Auth schema validation on the generated client and the migrated database', async () => {
    const context = await auth.$context;
    expect(context.explicitSchemaCheck, 'schema check registered').toBeTypeOf('function');
    await context.explicitSchemaCheck?.();

    // The Prisma check reads the generated client, so also compare the real tables.
    const rows = await prisma.$queryRaw<{ columnDefault: string | null; columnName: string; isNullable: string; tableName: string }[]>`
      SELECT table_name AS "tableName", column_name AS "columnName", is_nullable AS "isNullable", column_default AS "columnDefault"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
    `;
    const tables = new Map<string, { hasDefault: boolean; name: string; nullable: boolean }[]>();
    for (const { columnDefault, columnName, isNullable, tableName } of rows) {
      const columns = tables.get(tableName) ?? [];
      columns.push({ hasDefault: columnDefault !== null, name: columnName, nullable: isNullable === 'YES' });
      tables.set(tableName, columns);
    }
    const database = [...tables].map(([name, columns]) => ({ columns, name }));
    const expected = getExpectedSchema(context.options);
    expect(Object.keys(expected)).toEqual(
      expect.arrayContaining(['account', 'invitation', 'member', 'organization', 'session', 'user', 'verification']),
    );
    expect(diffSchema(expected, database)).toEqual([]);

    const withoutCreatedAt = database.map((table) =>
      table.name === 'invitation' ? { ...table, columns: table.columns.filter(({ name }) => name !== 'createdAt') } : table,
    );
    expect(diffSchema(expected, withoutCreatedAt)).toEqual([{ column: 'createdAt', kind: 'missing-column', table: 'invitation' }]);
  });

  it('accepts an invitation inserted the way an older image inserts it', async () => {
    const { organizationId, userId } = await signInAsOwner();
    const email = addressFor('invitee');
    const id = `invitation-${run}`;
    await prisma.$executeRaw`
      INSERT INTO "invitation" ("id", "organizationId", "email", "role", "status", "expiresAt", "inviterId")
      VALUES (${id}, ${organizationId}, ${email}, 'member', 'pending', now() + interval '1 hour', ${userId})
    `;
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).createdAt).toBeInstanceOf(Date);

    const cookie = sessionCookie(await signInWithCode(email));
    expect((await send('/organization/accept-invitation', { body: { invitationId: id }, cookie })).status).toBe(200);
    expect(await prisma.member.count({ where: { organizationId, user: { email } } })).toBe(1);
  });

  it('keeps workspace invitations on the Nibleaf action that enforces the single-owner rule', async () => {
    const { cookie, organizationId } = await signInAsOwner();
    const email = addressFor('second-owner');
    const paths = ['/organization/invite-member', '/organization/invite-member/', '/organization//invite-member', '/organization/invite%2Dmember'];
    for (const path of paths) {
      const response = await send(path, { body: { email, organizationId, role: 'owner' }, cookie });
      expect(response.status, path).toBe(404);
    }
    expect(await prisma.invitation.count({ where: { email } })).toBe(0);
  });

  it('signs in with an email code, provisions a workspace, reads the session, and signs out', async () => {
    const email = addressFor('code');
    const response = await signInWithCode(email);
    const attributes = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`)) ?? '';
    expect(attributes).toContain('; HttpOnly');
    expect(attributes).toContain('; Secure');
    expect(attributes).toContain('; SameSite=Lax');
    expect(attributes).toContain('; Path=/');
    // Host-only on the app origin: the admin console calls that origin directly.
    expect(attributes).not.toMatch(/; Domain=/i);

    const cookie = sessionCookie(response);
    const current = await readSession(cookie);
    expect(current?.user.email).toBe(email);
    const userId = current?.user.id as string;
    expect(await prisma.member.count({ where: { role: 'owner', userId } })).toBe(1);

    expect((await send('/sign-out', { body: {}, cookie })).status).toBe(200);
    expect(await readSession(cookie)).toBeNull();
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
  });

  it('keeps a session whose cookie was signed before the upgrade', async () => {
    const user = await prisma.user.create({ data: { email: addressFor('existing'), emailVerified: true, name: 'Existing' } });
    const token = `existing-session-${run}`;
    await prisma.session.create({ data: { expiresAt: new Date(Date.now() + 60 * 60 * 1000), token, userId: user.id } });
    // The cookie format every released version has written: HMAC-SHA256, base64, URL-encoded.
    const signature = createHmac('sha256', AUTH_SECRET).update(token).digest('base64');
    const current = await readSession(`${SESSION_COOKIE}=${encodeURIComponent(`${token}.${signature}`)}`);
    expect(current?.user.id).toBe(user.id);
  });

  it('gives an operator an admin session on the shared app origin', async () => {
    const operator = await prisma.user.create({
      data: { email: addressFor('operator'), emailVerified: true, name: 'Operator', role: 'admin' },
    });
    const customer = await prisma.user.create({ data: { email: addressFor('customer'), emailVerified: true, name: 'Customer' } });

    const operatorCookie = sessionCookie(await signInWithCode(operator.email, ADMIN_ORIGIN));
    expect((await readSession(operatorCookie, ADMIN_ORIGIN))?.user.role).toBe('admin');
    expect((await send('/admin/list-users?limit=1', { cookie: operatorCookie, origin: ADMIN_ORIGIN })).status).toBe(200);

    const customerCookie = sessionCookie(await signInWithCode(customer.email));
    expect((await send('/admin/list-users?limit=1', { cookie: customerCookie })).status).toBe(403);

    const support = await send('/admin/impersonate-user', { body: { userId: customer.id }, cookie: operatorCookie, origin: ADMIN_ORIGIN });
    expect(support.status).toBe(200);
    const supportSession = await readSession(sessionCookie(support));
    expect(supportSession?.user.id).toBe(customer.id);
    expect(supportSession?.session.impersonatedBy).toBe(operator.id);
    const started = await prisma.platformEvent.findFirst({ where: { type: 'admin_impersonation_started', userId: customer.id } });
    expect(started?.metadata).toEqual({ actorUserId: operator.id });
  });

  it('creates a Google account and finds the same user on the next sign-in', async () => {
    const email = addressFor('google');
    const sub = `google-${run}`;
    const first = await signInWithGoogle(sub, email);
    expectSignedInRedirect(first);
    const user = await readSession(sessionCookie(first));
    expect(user?.user.email).toBe(email);
    const account = await prisma.account.findFirst({ where: { accountId: sub, providerId: 'google' } });
    expect(account?.userId).toBe(user?.user.id);
    expect(await prisma.member.count({ where: { role: 'owner', userId: user?.user.id } })).toBe(1);

    const second = await signInWithGoogle(sub, email);
    expectSignedInRedirect(second);
    expect((await readSession(sessionCookie(second)))?.user.id).toBe(user?.user.id);
    expect(await prisma.account.count({ where: { accountId: sub, providerId: 'google' } })).toBe(1);

    // Activation counts the sign-up once, and only the first device gets an alert.
    const userId = user?.user.id as string;
    expect(await prisma.platformEvent.count({ where: { type: 'signup_completed', userId } })).toBe(1);
    expect(await prisma.platformEvent.count({ where: { type: 'publish_clicked', userId } })).toBe(1);
    expect(mocks.emailsTo.filter((to) => to === email)).toHaveLength(1);
  });

  it.each([
    ['banned', { banned: true }, 302],
    ['suspended', { suspendedAt: new Date() }, 403],
  ])('creates no session for a %s Google user', async (label, state, status) => {
    const { email, sub, userId } = await createGoogleUser(label, state);
    const response = await signInWithGoogle(sub, email);
    expect(response.status).toBe(status);
    expect(response.headers.get('location')).not.toBe('/app');
    expect(setCookiePairs(response).some((pair) => pair?.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
  });

  it('refuses a new Google user when sign-up is disabled, and keeps existing users signing in', async () => {
    const existing = await createGoogleUser('closed-existing');
    const openAuth = auth;
    vi.resetModules();
    vi.stubEnv('DISABLE_SIGNUP', 'true');
    ({ auth } = await import('./server'));
    try {
      const email = addressFor('closed-new');
      const sub = `closed-new-${run}`;
      const refused = await signInWithGoogle(sub, email);
      expect(refused.status).toBe(302);
      expect(refused.headers.get('location')).toContain('error=signup_disabled');
      expect(await prisma.user.count({ where: { email } })).toBe(0);
      expect(await prisma.account.count({ where: { accountId: sub, providerId: 'google' } })).toBe(0);

      const returning = await signInWithGoogle(existing.sub, existing.email);
      expectSignedInRedirect(returning);
      expect((await readSession(sessionCookie(returning)))?.user.id).toBe(existing.userId);
    } finally {
      auth = openAuth;
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('signs in a returning Google user whose account row Better Auth 1.6 wrote', async () => {
    const email = addressFor('returning');
    const sub = `returning-${run}`;
    const createdAt = new Date('2026-06-01T00:00:00.000Z');
    const user = await prisma.user.create({ data: { createdAt, email, emailVerified: true, name: 'Returning', updatedAt: createdAt } });
    // The columns createOAuthUser wrote before 1.7: no issuer, and a comma-joined scope.
    const account = await prisma.account.create({
      data: {
        accessToken: 'access-token-from-1.6',
        accessTokenExpiresAt: new Date('2026-06-01T01:00:00.000Z'),
        accountId: sub,
        createdAt,
        idToken: 'id-token-from-1.6',
        providerId: 'google',
        scope: 'email,profile,openid',
        updatedAt: createdAt,
        userId: user.id,
      },
    });

    const response = await signInWithGoogle(sub, email);
    expectSignedInRedirect(response);
    expect((await readSession(sessionCookie(response)))?.user.id).toBe(user.id);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(await prisma.member.count({ where: { userId: user.id } })).toBe(0);
    const rows = await prisma.account.findMany({ where: { userId: user.id } });
    expect(rows.map(({ id }) => id)).toEqual([account.id]);
    expect(rows[0]?.createdAt).toEqual(createdAt);
    expect(rows[0]?.accessToken).toBe('synthetic-access-token');

    // Identity follows the Google subject, not the address on the token.
    const changedEmail = addressFor('returning-changed');
    const changed = await signInWithGoogle(sub, changedEmail);
    expectSignedInRedirect(changed);
    expect((await readSession(sessionCookie(changed)))?.user.id).toBe(user.id);
    expect(await prisma.user.count({ where: { email: changedEmail } })).toBe(0);
  });

  it('links Google to an existing email-code user with the same verified address', async () => {
    const email = addressFor('linked');
    const existing = await readSession(sessionCookie(await signInWithCode(email)));
    const sub = `linked-${run}`;
    const response = await signInWithGoogle(sub, email);
    expectSignedInRedirect(response);
    expect((await readSession(sessionCookie(response)))?.user.id).toBe(existing?.user.id);
    expect((await prisma.account.findFirst({ where: { accountId: sub, providerId: 'google' } }))?.userId).toBe(existing?.user.id);
  });

  it('does not link Google to a local account whose address was never verified', async () => {
    const email = addressFor('unverified');
    const user = await prisma.user.create({ data: { email, emailVerified: false, name: 'Unverified' } });
    const response = await signInWithGoogle(`unverified-${run}`, email);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('error=account_not_linked');
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0);
  });

  it('refuses a Google identity that matches more than one account', async () => {
    const email = addressFor('duplicate');
    const sub = `duplicate-${run}`;
    expectSignedInRedirect(await signInWithGoogle(sub, email));
    const other = await prisma.user.create({ data: { email: addressFor('other'), emailVerified: true, name: 'Other' } });
    await prisma.account.create({ data: { accountId: sub, providerId: 'google', userId: other.id } });

    const response = await signInWithGoogle(sub, email);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('error=internal_server_error');
    expect(setCookiePairs(response).some((pair) => pair?.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
  });
});
