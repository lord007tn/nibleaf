import { Hono } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import { rateLimit } from '@/middlewares/rate-limit';
import assets from './assets/handlers';
import domains from './domains/handlers';
import invitations from './invitations/handlers';
import sites from './sites/handlers';
import waitlist from './waitlist/handlers';

// Throttle unauthenticated public traffic (site shell, search, pageview tracking).
const app = new Hono<HonoEnv>()
  .use('*', rateLimit({ windowMs: 60_000, max: 120 }))
  .route('/sites', sites)
  .route('/domains', domains)
  .route('/invitations', invitations)
  .route('/assets', assets)
  .route('/waitlist', waitlist);

export default app;
