import { waitlistSubmitBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { addToWaitlist } from '@/actions/waitlist';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import waitlistRoutes from './routes';

const app = new Hono<HonoEnv>().post('/', ...waitlistRoutes.submit, validator('json', waitlistSubmitBody), async (ctx) => {
  return ctx.json({ data: await addToWaitlist(ctx.req.valid('json')) }, 200);
});

export default app;
