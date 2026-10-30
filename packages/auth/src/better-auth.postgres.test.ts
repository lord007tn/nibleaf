import { createHmac, randomUUID } from 'node:crypto';
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
  return { ADMIN_ORIGIN, APP_ORIGIN, AUTH_SECRET, GOOGLE_CLIENT_ID, mocks: { codes: new Map<string, string>(), googleIdToken: '' } };
});

vi.mock('@nibleaf/bullmq', () => ({
  createJob: vi.fn(async (_queue: string, job: { data?: { auth?: unknown; text?: string; to?: string } }) => {
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
  let auth: (typeof import('./server'))['auth'];

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
    const cookie = setCookiePairs(response).find((pair) => pair?.startsWith(`${SESSION_COOKIE}=`));
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

    const second = await signInWithGoogle(sub, email);
    expectSignedInRedirect(second);
    expect((await readSession(sessionCookie(second)))?.user.id).toBe(user?.user.id);
    expect(await prisma.account.count({ where: { accountId: sub, providerId: 'google' } })).toBe(1);
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
});
