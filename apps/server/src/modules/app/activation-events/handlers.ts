import { Hono } from 'hono';
import { recordFirstPublishStage } from '@/actions/platform-events';
import { getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import activationEventRoutes from './routes';
import { firstPublishActivationBody } from './schema';

const app = new Hono<HonoEnv>().post('/', ...activationEventRoutes.record, validator('json', firstPublishActivationBody), async (ctx) => {
  ctx.header('Cache-Control', 'private, no-store');
  getContextUserOrThrow();
  await recordFirstPublishStage(ctx.req.valid('json'));
  return ctx.json({ data: { recorded: true as const } }, 200);
});

export default app;
