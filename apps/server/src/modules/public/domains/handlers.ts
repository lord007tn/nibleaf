import { Hono } from 'hono';
import { z } from 'zod';
import { resolveDomainHost } from '@/actions/sites';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import domainsRoutes from './routes';

const resolveQuery = z.object({ host: z.string() });

const app = new Hono<HonoEnv>().get('/resolve', ...domainsRoutes.resolve, validator('query', resolveQuery), async (ctx) => {
  const { host } = ctx.req.valid('query');
  return ctx.json({ data: { projectId: await resolveDomainHost(host) } }, 200);
});

export default app;
