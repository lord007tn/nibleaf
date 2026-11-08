import { Hono } from 'hono';
import { joinWithLink } from '@/actions/join-links';
import { getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import routes from './routes';

const app = new Hono<HonoEnv>().post('/:token', ...routes.join, async (ctx) =>
  ctx.json({ data: await joinWithLink(ctx.req.param('token'), getContextUserOrThrow().id) }, 200),
);

export default app;
