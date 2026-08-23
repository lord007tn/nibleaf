import { Hono } from 'hono';
import { getInvitationInfo } from '@/actions/members';
import type { HonoEnv } from '@/lib/hono/context';
import invitationsRoutes from './routes';

const app = new Hono<HonoEnv>().get('/:id', ...invitationsRoutes.info, async (ctx) =>
  ctx.json({ data: await getInvitationInfo(ctx.req.param('id')) }, 200),
);

export default app;
