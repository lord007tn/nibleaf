import { Hono } from 'hono';
import { getSiteOgData } from '@/actions/sites';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { cachedSiteOg, type SiteOgData, siteOgEtag } from '@/lib/site-og';
import { rateLimit } from '@/middlewares/rate-limit';

/** Access is rechecked before cache hits AND conditional responses. A signed-in
 * private reader must get the same non-disclosing 404 as an anonymous crawler. */
const app: Hono<HonoEnv> = new Hono<HonoEnv>().get('/:id/og/*', rateLimit({ windowMs: 60_000, max: 60 }), async (ctx) => {
  ctx.header('Cache-Control', 'private, no-store');
  const suffix = ctx.req.path.split('/og/').slice(1).join('/og/');
  if (!suffix.endsWith('.png') || suffix.length > 2048) return ctx.body(null, 404);
  let path: string;
  try {
    path = decodeURIComponent(suffix.slice(0, -4));
  } catch {
    return ctx.body(null, 404);
  }
  let data: SiteOgData;
  try {
    data = await getSiteOgData(ctx.req.param('id'), path, ctx.req.query('lang'), path.split('/')[0]);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return ctx.body(null, 404);
    throw error;
  }
  const etag = siteOgEtag(data);
  if (
    ctx.req
      .header('if-none-match')
      ?.split(',')
      .some((value) => value.trim().replace(/^W\//u, '') === etag || value.trim() === '*')
  ) {
    return ctx.body(null, 304, { 'Cache-Control': 'public, max-age=86400', ETag: etag });
  }
  const generation = cachedSiteOg(data);
  if (!generation) return ctx.body(null, 429, { 'Retry-After': '60' });
  return ctx.body(new Uint8Array(await generation), 200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=86400',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  });
});

export default app;
