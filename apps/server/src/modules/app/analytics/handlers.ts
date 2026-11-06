import { analyticsInsightsQuery, analyticsPageInsightsQuery, analyticsQuery } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAnalyticsOverview, getProjectAnalyticsExport } from '@/actions/analytics';
import {
  getAiVisibilityInsights,
  getFeedbackInsights,
  getOverviewInsights,
  getPageDetailInsights,
  getPagesInsights,
  getPerformanceInsights,
  getSearchInsights,
} from '@/actions/analytics-insights';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import analyticsRoutes from './routes';

const exportQuery = z.object({ before: z.iso.datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(100_000).optional() });

const app = new Hono<HonoEnv>()
  .get('/insights/overview', ...analyticsRoutes.insights, validator('query', analyticsInsightsQuery), async (ctx) => {
    const data = await getOverviewInsights(getContextOrganizationIdOrThrow(), ctx.req.param('projectId') ?? '', ctx.req.valid('query'));
    return ctx.json({ data }, 200);
  })
  .get('/insights/pages', ...analyticsRoutes.insights, validator('query', analyticsInsightsQuery), async (ctx) => {
    const data = await getPagesInsights(getContextOrganizationIdOrThrow(), ctx.req.param('projectId') ?? '', ctx.req.valid('query'));
    return ctx.json({ data }, 200);
  })
  .get('/insights/page', ...analyticsRoutes.insights, validator('query', analyticsPageInsightsQuery), async (ctx) => {
    const data = await getPageDetailInsights(getContextOrganizationIdOrThrow(), ctx.req.param('projectId') ?? '', ctx.req.valid('query'));
    return ctx.json({ data }, 200);
  })
  .get('/insights/search', ...analyticsRoutes.insights, validator('query', analyticsInsightsQuery), async (ctx) => {
    const data = await getSearchInsights(getContextOrganizationIdOrThrow(), ctx.req.param('projectId') ?? '', ctx.req.valid('query'));
    return ctx.json({ data }, 200);
  })
  .get('/insights/feedback', ...analyticsRoutes.insights, validator('query', analyticsInsightsQuery), async (ctx) => {
    const data = await getFeedbackInsights(getContextOrganizationIdOrThrow(), ctx.req.param('projectId') ?? '', ctx.req.valid('query'));
    return ctx.json({ data }, 200);
  })
  .get('/insights/ai', ...analyticsRoutes.insights, validator('query', analyticsInsightsQuery), async (ctx) => {
    const data = await getAiVisibilityInsights(getContextOrganizationIdOrThrow(), ctx.req.param('projectId') ?? '', ctx.req.valid('query'));
    return ctx.json({ data }, 200);
  })
  .get('/insights/performance', ...analyticsRoutes.insights, validator('query', analyticsInsightsQuery), async (ctx) => {
    const data = await getPerformanceInsights(getContextOrganizationIdOrThrow(), ctx.req.param('projectId') ?? '', ctx.req.valid('query'));
    return ctx.json({ data }, 200);
  })
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
