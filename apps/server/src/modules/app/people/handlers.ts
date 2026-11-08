import { Hono } from 'hono';
import { listPeople } from '@/actions/people';
import { getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import routes from './routes';

const app = new Hono<HonoEnv>().get('/', ...routes.list, async (ctx) => ctx.json({ data: await listPeople(getContextUserOrThrow().id) }, 200));

export default app;
