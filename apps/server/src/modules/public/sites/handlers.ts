import { searchQuery, trackEventBody } from '@nibleaf/validators';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import {
  getSite,
  getSiteChangelog,
  getSiteLlmsFullTxt,
  getSiteLlmsTxt,
  getSitePage,
  getSiteRobots,
  getSiteSitemap,
  recordSiteEvent,
  type SiteTextDocument,
  searchSite,
} from '@/actions/sites';
import { deliveryCacheHeaders } from '@/lib/delivery-cache';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import sitesRoutes from './routes';

const siteQuery = z.object({ lang: z.string().optional(), version: z.string().optional() });
const pageQuery = z.object({ path: z.string().default(''), lang: z.string().optional(), version: z.string().optional() });
const siteSearchQuery = searchQuery.extend({ lang: z.string().optional(), version: z.string().optional() });

/** Shared-cache policy for published-site data: CDNs/proxies may keep it for a
 *  minute and serve stale for five while revalidating. Content only changes on
 *  publish, and live chrome edits surface within the s-maxage window. */
const PUBLIC_CACHE = 'public, s-maxage=60, stale-while-revalidate=300';

/** Mark a published-site response shared-cacheable — but never for private
 *  sites: their responses depend on the viewer's session cookie, and a shared
 *  cache would leak one member's view to anonymous visitors. */
const setSiteCache = (ctx: Context<HonoEnv>, project: { config?: Record<string, unknown> | null }): void => {
  const isPrivate = (project.config as { visibility?: string } | null)?.visibility === 'private';
  for (const [name, value] of Object.entries(deliveryCacheHeaders(isPrivate, PUBLIC_CACHE))) ctx.header(name, value);
};

/** Serve a SiteTextDocument (sitemap/robots/llms) with the right cacheability. */
const textDocument = (ctx: Context<HonoEnv>, doc: SiteTextDocument, contentType: string) =>
  ctx.body(doc.body, 200, {
    'Content-Type': contentType,
    ...deliveryCacheHeaders(doc.isPrivate, PUBLIC_CACHE),
  });

const app = new Hono<HonoEnv>()
  .get('/:id', ...sitesRoutes.site, validator('query', siteQuery), async (ctx) => {
    const { lang, version } = ctx.req.valid('query');
    const data = await getSite(ctx.req.param('id'), lang, version);
    setSiteCache(ctx, data.project);
    return ctx.json({ data }, 200);
  })
  .get('/:id/page', ...sitesRoutes.page, validator('query', pageQuery), async (ctx) => {
    const { path, lang, version } = ctx.req.valid('query');
    const data = await getSitePage(ctx.req.param('id'), path, lang, version);
    setSiteCache(ctx, data.project);
    return ctx.json({ data }, 200);
  })
  .get('/:id/search', ...sitesRoutes.search, validator('query', siteSearchQuery), async (ctx) => {
    const { q, limit, lang, version } = ctx.req.valid('query');
    ctx.header('Cache-Control', 'private, no-store');
    ctx.header('Vary', 'Cookie, Authorization');
    return ctx.json({ data: await searchSite(ctx.req.param('id'), q, lang, limit, version) }, 200);
  })
  .post('/:id/events', ...sitesRoutes.track, validator('json', trackEventBody), async (ctx) => {
    ctx.header('Cache-Control', 'private, no-store');
    return ctx.json({ data: await recordSiteEvent(ctx.req.param('id'), ctx.req.valid('json')) }, 200);
  })
  .get('/:id/changelog', ...sitesRoutes.changelog, async (ctx) => {
    ctx.header('Cache-Control', 'private, no-store');
    ctx.header('Vary', 'Cookie, Authorization');
    return ctx.json({ data: await getSiteChangelog(ctx.req.param('id')) }, 200);
  })
  .get('/:id/sitemap.xml', ...sitesRoutes.sitemap, async (ctx) =>
    textDocument(ctx, await getSiteSitemap(ctx.req.param('id')), 'application/xml; charset=utf-8'),
  )
  .get('/:id/robots.txt', ...sitesRoutes.robots, async (ctx) =>
    textDocument(ctx, await getSiteRobots(ctx.req.param('id')), 'text/plain; charset=utf-8'),
  )
  .get('/:id/llms.txt', ...sitesRoutes.llms, async (ctx) => textDocument(ctx, await getSiteLlmsTxt(ctx.req.param('id')), 'text/plain; charset=utf-8'))
  .get('/:id/llms-full.txt', ...sitesRoutes.llmsFull, async (ctx) =>
    textDocument(ctx, await getSiteLlmsFullTxt(ctx.req.param('id')), 'text/plain; charset=utf-8'),
  );

export default app;
