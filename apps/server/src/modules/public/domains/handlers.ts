import { Hono } from 'hono';
import { z } from 'zod';
import { resolveDomainHost } from '@/actions/sites';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import domainsRoutes from './routes';

// `host` is our own app-edge caller; `domain` is what Caddy's on_demand_tls
// `ask` endpoint sends — accept either so a Caddy sidecar can gate certificate
// issuance on this endpoint without an adapter.
const resolveQuery = z
  .object({ host: z.string().optional(), domain: z.string().optional() })
  .refine((q) => Boolean(q.host || q.domain), { message: 'host or domain is required' });

const app = new Hono<HonoEnv>().get('/resolve', ...domainsRoutes.resolve, validator('query', resolveQuery), async (ctx) => {
  const { host, domain } = ctx.req.valid('query');
  const projectId = await resolveDomainHost((host ?? domain) as string);
  // Non-200 for unknown hosts so Caddy's `ask` refuses to mint certificates for
  // domains we don't serve. The app edge parses the JSON body regardless.
  return ctx.json({ data: { projectId } }, projectId ? 200 : 404);
});

export default app;
