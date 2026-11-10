import { Hono } from 'hono';
import { admit } from '@/actions/admissions';
import { getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { isAuthenticated } from '@/middlewares/guard';

const app = new Hono<HonoEnv>().post('/:id/accept', isAuthenticated, async (ctx) =>
  ctx.json({ data: await admit(getContextUserOrThrow().id, { invitationId: ctx.req.param('id') }) }),
);
export default app;
