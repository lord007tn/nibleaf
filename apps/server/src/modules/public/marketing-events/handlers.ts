import { Hono } from 'hono';
import { recordMarketingEvent } from '@/actions/marketing-events';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import marketingEventRoutes from './routes';
import { marketingEventBody } from './schema';

const app = new Hono<HonoEnv>().post('/', ...marketingEventRoutes.record, validator('json', marketingEventBody), async (ctx) => {
  ctx.header('Cache-Control', 'private, no-store');
  const body = ctx.req.valid('json');
  return ctx.json({ data: await recordMarketingEvent(body.event, body.properties) }, 200);
});

export default app;
