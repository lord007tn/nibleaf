import { Hono } from 'hono';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';
import { rateLimit } from '@/middlewares/rate-limit';
import assets from './assets/handlers';
import domains from './domains/handlers';
import git from './git/handlers';
import invitations from './invitations/handlers';
import marketingEvents from './marketing-events/handlers';
import meta from './meta/handlers';
import readerAccess from './reader-access/handlers';
import sites from './sites/handlers';

/** Machine/edge traffic that must not compete with human page views for the
 *  per-IP budget: the cheap crawler files (sitemap.xml, robots.txt), the app
 *  edge's host→project resolution, and the instance meta probe. Cheap to serve,
 *  and starving them breaks custom-domain serving and crawl health for everyone
 *  behind that IP. llms.txt / llms-full.txt are deliberately NOT here: building
 *  them re-serializes every page's Markdown (llms-full is the single most
 *  expensive public response), so they stay on the standard limiter. */
const LOW_COST_PATH = /(\/sitemap\.xml|\/robots\.txt)$|\/api\/public\/domains\/resolve$|\/api\/public\/meta\/?$/;

const publicPerMinute = envExtras.RATE_LIMIT_PUBLIC_PER_MIN;
const standardLimiter = rateLimit({ windowMs: 60_000, max: publicPerMinute });
// Generous (not unlimited) so a misbehaving crawler is still bounded.
const lowCostLimiter = rateLimit({ windowMs: 60_000, max: publicPerMinute * 10 });

// Throttle unauthenticated public traffic (site shell, search, pageview tracking).
const app = new Hono<HonoEnv>()
  .use('*', (ctx, next) => (LOW_COST_PATH.test(ctx.req.path) ? lowCostLimiter(ctx, next) : standardLimiter(ctx, next)))
  // Activation and JWT exchange create credentials. Give them a tighter
  // abuse budget than ordinary content/search requests.
  .use('/reader-access/*', rateLimit({ windowMs: 60_000, max: 20 }))
  .use('/marketing-events/*', rateLimit({ windowMs: 60_000, max: 30 }))
  .route('/sites', sites)
  .route('/domains', domains)
  .route('/git', git)
  .route('/invitations', invitations)
  .route('/marketing-events', marketingEvents)
  .route('/assets', assets)
  .route('/reader-access', readerAccess)
  .route('/meta', meta);

export default app;
