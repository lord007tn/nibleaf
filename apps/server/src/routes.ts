import { auth } from '@nibleaf/auth/server';
import { Hono } from 'hono';
import { env } from './env';
import type { HonoEnv } from './lib/hono/context';
import { rateLimit } from './middlewares/rate-limit';
import modules from './modules';
import baseApp from './server';

const adminOrigin = new URL(env.ADMIN_URL);

/** The public dashboard may keep email/password auth, but the isolated admin
 * origin is deliberately OTP-only. Check the browser Origin first and proxy
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

const apiApp = new Hono<HonoEnv>()
  // Throttle better-auth endpoints to blunt credential-stuffing / brute-force attempts.
  .use('/auth/*', rateLimit({ windowMs: 60_000, max: 30 }))
  .use('/auth/sign-in/email', async (ctx, next) => {
    if (ctx.req.method === 'POST' && isAdminOriginRequest(ctx.req.raw)) {
      return ctx.json({ error: { message: 'Password sign-in is disabled on the admin console. Request a one-time code instead.' } }, 403);
    }
    await next();
  })
  .on(['POST', 'GET'], '/auth/*', (ctx) => auth.handler(ctx.req.raw))
  .route('/', modules);

const app = baseApp.route('/api', apiApp);

export default app;
export type AppType = typeof app;
