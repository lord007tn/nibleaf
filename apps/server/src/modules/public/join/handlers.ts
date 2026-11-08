import { Hono } from 'hono';
import { getJoinLinkPreview } from '@/actions/join-links';
import type { HonoEnv } from '@/lib/hono/context';
import routes from './routes';

const app = new Hono<HonoEnv>().get('/:token', ...routes.preview, async (ctx) => {
  ctx.header('Cache-Control', 'private, no-store');
  return ctx.json({ data: await getJoinLinkPreview(ctx.req.param('token')) }, 200);
});

export default app;
