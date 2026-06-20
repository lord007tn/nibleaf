import { Hono } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import { rateLimit } from '@/middlewares/rate-limit';
import assets from './assets/handlers';
import sites from './sites/handlers';

// Throttle unauthenticated public traffic (site shell, search, pageview tracking).
const app = new Hono<HonoEnv>().use('*', rateLimit({ windowMs: 60_000, max: 120 })).route('/sites', sites).route('/assets', assets);

export default app;
