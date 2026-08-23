import { type Prisma, prisma } from '@nibleaf/database';
import { Hono } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import marketingEventRoutes from './routes';
import { marketingEventBody } from './schema';

const app = new Hono<HonoEnv>().post('/', ...marketingEventRoutes.record, validator('json', marketingEventBody), async (ctx) => {
  ctx.header('Cache-Control', 'private, no-store');
  const body = ctx.req.valid('json');
  await prisma.platformEvent.create({ data: { type: body.event, metadata: body.properties as Prisma.InputJsonValue } });
  return ctx.json({ data: { recorded: true as const } }, 200);
});

export default app;
