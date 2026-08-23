import { auth } from '@nibleaf/auth/server';
import { prisma } from '@nibleaf/database';
import { Hono } from 'hono';
import { env } from './env';
import type { HonoEnv } from './lib/hono/context';
import { rateLimit } from './middlewares/rate-limit';
import modules from './modules';
import baseApp from './server';

const adminOrigin = new URL(env.ADMIN_URL);

/** Customer OTP sign-in may create an account, but the isolated admin origin
 * is account-only. Check the browser Origin first and proxy
 * forwarding headers as a backstop; the internal API is not publicly exposed. */
const isAdminOriginRequest = (request: Request): boolean => {
  const candidates = [request.headers.get('origin'), request.headers.get('referer'), request.headers.get('x-forwarded-host')]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try {
        return value.includes('://') ? new URL(value).host : value.split(',')[0]?.trim();
      } catch {
        return null;
      }
    });
  return candidates.includes(adminOrigin.host);
};

const emailFromJsonBody = async (request: Request): Promise<string | null> => {
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    return typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
};

const isPlatformAdminEmail = async (email: string | null): Promise<boolean> => {
  if (!email) {
    return false;
  }
  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  return user?.role === 'admin';
};

const apiApp = new Hono<HonoEnv>()
  // Throttle better-auth endpoints to blunt credential-stuffing / brute-force attempts.
  .use('/auth/*', rateLimit({ windowMs: 60_000, max: 30 }))
  .use('/auth/email-otp/send-verification-otp', async (ctx, next) => {
    if (ctx.req.method === 'POST' && isAdminOriginRequest(ctx.req.raw)) {
      const email = await emailFromJsonBody(ctx.req.raw);
      if (!(await isPlatformAdminEmail(email))) {
        // Match a successful request so the admin console cannot enumerate users.
        return ctx.json({ success: true });
      }
    }
    await next();
  })
  .use('/auth/sign-in/email-otp', async (ctx, next) => {
    if (ctx.req.method === 'POST' && isAdminOriginRequest(ctx.req.raw)) {
      const email = await emailFromJsonBody(ctx.req.raw);
      if (!(await isPlatformAdminEmail(email))) {
        return ctx.json({ code: 'INVALID_OTP', message: 'Invalid OTP' }, 400);
      }
    }
    await next();
  })
  // Historical reset emails pointed at Better Auth's API token route. Password
  // auth is disabled now, so take those recipients to the passwordless flow.
  .get('/auth/reset-password/:token', (ctx) => ctx.redirect(new URL('/sign-in', env.APP_URL).toString(), 302))
  .on(['POST', 'GET'], '/auth/*', (ctx) => auth.handler(ctx.req.raw))
  .route('/', modules);

const app = baseApp.route('/api', apiApp);

export default app;
