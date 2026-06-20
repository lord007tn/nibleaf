import { analyticsQuery } from '@plume/validators';
import { Hono } from 'hono';
import { validator } from 'hono-openapi';
import { getAnalyticsOverview } from '@/actions/analytics';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import analyticsRoutes from './routes';

const app = new Hono<HonoEnv>().get('/', ...analyticsRoutes.overview, validator('query', analyticsQuery), async (ctx) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId') ?? '';
  const { range } = ctx.req.valid('query');
  return ctx.json({ data: await getAnalyticsOverview(organizationId, projectId, range) }, 200);
});

export default app;
