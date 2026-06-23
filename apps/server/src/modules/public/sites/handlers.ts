import { searchQuery, trackEventBody } from '@plume/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import { getSite, getSiteChangelog, getSitePage, getSiteRobots, getSiteSitemap, recordSiteEvent, searchSite } from '@/actions/sites';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
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
  .get('/:id/changelog', ...sitesRoutes.changelog, async (ctx) => ctx.json({ data: await getSiteChangelog(ctx.req.param('id')) }, 200))
  .get('/:id/sitemap.xml', ...sitesRoutes.sitemap, async (ctx) =>
    ctx.body(await getSiteSitemap(ctx.req.param('id')), 200, { 'Content-Type': 'application/xml; charset=utf-8' }),
  )
  .get('/:id/robots.txt', ...sitesRoutes.robots, async (ctx) =>
    ctx.body(await getSiteRobots(ctx.req.param('id')), 200, { 'Content-Type': 'text/plain; charset=utf-8' }),
  );

export default app;
