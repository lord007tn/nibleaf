import { analyticsQuery } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAnalyticsOverview, getProjectAnalyticsExport } from '@/actions/analytics';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import analyticsRoutes from './routes';

const exportQuery = z.object({ before: z.iso.datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(100_000).optional() });

const app = new Hono<HonoEnv>()
  .get('/export', ...analyticsRoutes.export, validator('query', exportQuery), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const projectId = ctx.req.param('projectId') ?? '';
    const { before, limit } = ctx.req.valid('query');
    return ctx.json({ data: await getProjectAnalyticsExport(organizationId, projectId, before, limit) }, 200);
  })
  .get('/', ...analyticsRoutes.overview, validator('query', analyticsQuery), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const projectId = ctx.req.param('projectId') ?? '';
    const { range, timezone } = ctx.req.valid('query');
    return ctx.json({ data: await getAnalyticsOverview(organizationId, projectId, range, timezone) }, 200);
  });

export default app;
