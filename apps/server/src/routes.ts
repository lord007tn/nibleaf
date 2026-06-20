import { auth } from '@plume/auth/server';
import { Hono } from 'hono';
import type { HonoEnv } from './lib/hono/context';
import { rateLimit } from './middlewares/rate-limit';
import modules from './modules';
import baseApp from './server';

const apiApp = new Hono<HonoEnv>()
  // Throttle better-auth endpoints to blunt credential-stuffing / brute-force attempts.
  .use('/auth/*', rateLimit({ windowMs: 60_000, max: 30 }))
  .on(['POST', 'GET'], '/auth/*', (ctx) => auth.handler(ctx.req.raw))
  .route('/', modules);

const app = baseApp.route('/api', apiApp);

export default app;
export type AppType = typeof app;
