import { Hono } from 'hono';
import { z } from 'zod';
import { listPeople, MAX_PEOPLE_PAGE_SIZE, PEOPLE_PAGE_SIZE } from '@/actions/people';
import { getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import routes from './routes';

const peopleQuery = z.object({
  q: z.string().trim().max(200).default(''),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PEOPLE_PAGE_SIZE).default(PEOPLE_PAGE_SIZE),
});

const app = new Hono<HonoEnv>().get('/', ...routes.list, validator('query', peopleQuery), async (ctx) =>
  ctx.json({ data: await listPeople(getContextUserOrThrow().id, ctx.req.valid('query')) }, 200),
);

export default app;
