import { randomUUID } from 'node:crypto';
import { consentStateSchema, publicAnalyticsEventSchema } from '@nibleaf/clickhouse';
import { searchAnswerBody, searchQuery, siteChatBody, siteChatEventsBody, siteChatFeedbackBody } from '@nibleaf/validators';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { chatSite, submitSiteChatFeedback } from '@/actions/site-chat';
import { recordSiteChatEvents } from '@/actions/site-chat-events';
import {
  answerSite,
  getSite,
  getSiteChangelog,
  getSiteChangelogRss,
  getSiteLlmsFullTxt,
  getSiteLlmsTxt,
  getSiteOpenApi,
  getSitePage,
  getSitePageMarkdown,
  getSiteRobots,
  getSiteSitemap,
  recordSiteEvent,
  type SiteTextDocument,
  searchSite,
} from '@/actions/sites';
import { deliveryCacheHeaders } from '@/lib/delivery-cache';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import { crawlerBatchSchema, enqueueCrawlerHit, hasInternalAnalyticsProof } from './crawler-hits';
import sitesRoutes from './routes';

const siteQuery = z.object({ lang: z.string().optional(), version: z.string().optional() });
const pageQuery = z.object({ path: z.string().default(''), lang: z.string().optional(), version: z.string().optional() });
const siteSearchQuery = searchQuery.extend({
  lang: z.string().optional(),
  version: z.string().optional(),
  sessionId: z.string().max(128).optional(),
  consentState: consentStateSchema.default('unknown'),
});

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
  .post(
    '/_crawler-hits',
    async (ctx, next) => {
      if (!hasInternalAnalyticsProof(ctx.req.header('x-nibleaf-internal'))) return ctx.json({ error: 'unauthorized' }, 401);
      // Limit before parsing the authenticated internal batch as well.
      if (Number(ctx.req.header('content-length') ?? 0) > 300_000) return ctx.body(null, 413);
      return next();
    },
    bodyLimit({ maxSize: 300_000 }),
    validator('json', crawlerBatchSchema),
    (ctx) => {
      let accepted = 0;
      for (const hit of ctx.req.valid('json').hits) if (enqueueCrawlerHit(hit)) accepted += 1;
      return ctx.json({ data: { accepted } }, 202);
    },
  )
  .use('/:id/*', async (ctx, next) => {
    const started = performance.now();
    await next();
    // Skip Nibleaf's own SSR/proxy fetches: the app server observes the outer
    // request itself. `x-nibleaf-ssr` is a non-secret hint so this also holds
    // when INTERNAL_API_SECRET is unset; spoofing it only hides the sender's own request.
    if (ctx.req.method !== 'GET' || ctx.req.header('x-nibleaf-ssr') === '1' || hasInternalAnalyticsProof(ctx.req.header('x-nibleaf-internal')))
      return;
    const url = new URL(ctx.req.url);
    const resource = url.pathname.split('/').pop() ?? '';
    if (!['page', 'markdown', 'llms.txt', 'llms-full.txt', 'sitemap.xml', 'robots.txt', 'openapi.json', 'rss.xml'].includes(resource)) return;
    const path =
      resource === 'page'
        ? (url.searchParams.get('path') ?? '')
        : resource === 'markdown'
          ? `${url.searchParams.get('path') ?? ''}.md`
          : `/${resource}`;
    enqueueCrawlerHit({
      identifier: ctx.req.param('id') ?? '',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      path: path.slice(0, 512),
      userAgent: (ctx.req.header('user-agent') ?? '').slice(0, 2048),
      statusCode: ctx.res.status,
      contentType: (ctx.res.headers.get('content-type') ?? '').slice(0, 120),
      durationMs: Math.min(3_600_000, Math.round(performance.now() - started)),
    });
  })
  .post('/:id/chat/events', ...sitesRoutes.chatEvents, validator('json', siteChatEventsBody), async (ctx) => {
    ctx.header('Cache-Control', 'private, no-store');
    return ctx.json({ data: await recordSiteChatEvents(ctx.req.param('id'), ctx.req.valid('json')) }, 200);
  })
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
  .get('/:id/markdown', ...sitesRoutes.markdown, validator('query', pageQuery), async (ctx) => {
    const { path, lang, version } = ctx.req.valid('query');
    return textDocument(ctx, await getSitePageMarkdown(ctx.req.param('id'), path, lang, version), 'text/markdown; charset=utf-8');
  })
  .get('/:id/openapi.json', ...sitesRoutes.openapi, async (ctx) => {
    const data = await getSiteOpenApi(ctx.req.param('id'));
    setSiteCache(ctx, data.project);
    const etag = `"${data.metadata.contentHash}"`;
    ctx.header('ETag', etag);
    ctx.header('Content-Disposition', 'inline; filename="openapi.json"');
    if (ctx.req.header('if-none-match') === etag) {
      return ctx.body(null, 304);
    }
    return ctx.json(data.document, 200);
  })
  .get('/:id/search', ...sitesRoutes.search, validator('query', siteSearchQuery), async (ctx) => {
    const { q, limit, lang, version, sessionId, consentState } = ctx.req.valid('query');
    ctx.header('Cache-Control', 'private, no-store');
    ctx.header('Vary', 'Cookie, Authorization');
    return ctx.json({ data: await searchSite(ctx.req.param('id'), q, lang, limit, version, { sessionId, consentState }) }, 200);
  })
  .post('/:id/answer', ...sitesRoutes.answer, validator('json', searchAnswerBody), async (ctx) => {
    const { q, lang, version } = ctx.req.valid('json');
    ctx.header('Cache-Control', 'private, no-store');
    ctx.header('Vary', 'Cookie, Authorization');
    return ctx.json({ data: await answerSite(ctx.req.param('id'), q, lang, version) }, 200);
  })
  .post('/:id/chat', ...sitesRoutes.chat, validator('json', siteChatBody), async (ctx) => chatSite(ctx.req.param('id'), ctx.req.valid('json')))
  .put('/:id/chat/feedback', ...sitesRoutes.chatFeedback, validator('json', siteChatFeedbackBody), async (ctx) => {
    ctx.header('Cache-Control', 'private, no-store');
    return ctx.json({ data: await submitSiteChatFeedback(ctx.req.param('id'), ctx.req.valid('json')) }, 200);
  })
  .post('/:id/events', ...sitesRoutes.track, validator('json', publicAnalyticsEventSchema), async (ctx) => {
    ctx.header('Cache-Control', 'private, no-store');
    return ctx.json({ data: await recordSiteEvent(ctx.req.param('id'), ctx.req.valid('json')) }, 200);
  })
  .get('/:id/changelog', ...sitesRoutes.changelog, async (ctx) => {
    ctx.header('Cache-Control', 'private, no-store');
    ctx.header('Vary', 'Cookie, Authorization');
    return ctx.json({ data: await getSiteChangelog(ctx.req.param('id')) }, 200);
  })
  .get('/:id/changelog/rss.xml', ...sitesRoutes.changelogRss, async (ctx) =>
    textDocument(ctx, await getSiteChangelogRss(ctx.req.param('id')), 'application/rss+xml; charset=utf-8'),
  )
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
