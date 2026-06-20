import { searchQuery, trackEventBody } from '@plume/validators';
import { Hono } from 'hono';
import { validator } from 'hono-openapi';
import { z } from 'zod';
import { getSite, getSiteChangelog, getSitePage, recordSiteEvent, searchSite } from '@/actions/sites';
import type { HonoEnv } from '@/lib/hono/context';
import sitesRoutes from './routes';

const siteQuery = z.object({ lang: z.string().optional() });
const pageQuery = z.object({ path: z.string().default(''), lang: z.string().optional() });
const siteSearchQuery = searchQuery.extend({ lang: z.string().optional() });

const app = new Hono<HonoEnv>()
  .get('/:id', ...sitesRoutes.site, validator('query', siteQuery), async (ctx) => {
    const { lang } = ctx.req.valid('query');
    return ctx.json({ data: await getSite(ctx.req.param('id'), lang) }, 200);
  })
  .get('/:id/page', ...sitesRoutes.page, validator('query', pageQuery), async (ctx) => {
    const { path, lang } = ctx.req.valid('query');
    return ctx.json({ data: await getSitePage(ctx.req.param('id'), path, lang) }, 200);
  })
  .get('/:id/search', ...sitesRoutes.search, validator('query', siteSearchQuery), async (ctx) => {
    const { q, limit, lang } = ctx.req.valid('query');
    return ctx.json({ data: await searchSite(ctx.req.param('id'), q, lang, limit) }, 200);
  })
  .post('/:id/events', ...sitesRoutes.track, validator('json', trackEventBody), async (ctx) => {
    return ctx.json({ data: await recordSiteEvent(ctx.req.param('id'), ctx.req.valid('json')) }, 200);
  })
  .get('/:id/changelog', ...sitesRoutes.changelog, async (ctx) => ctx.json({ data: await getSiteChangelog(ctx.req.param('id')) }, 200));

export default app;
