import { Readable } from 'node:stream';
import { getObjectStream, headObject } from '@nibleaf/storage';
import { Hono } from 'hono';
import { isProjectTakenDown, projectDeliveryAccess } from '@/actions/sites';
import { notFound } from '@/errors';
import { publicAssetResponseHeaders } from '@/lib/asset-response';
import { deliveryCacheHeaders } from '@/lib/delivery-cache';
import type { HonoEnv } from '@/lib/hono/context';
import assetRoutes from './routes';

// Proxy stored assets through the API. This gives a stable, browser-reachable
// public URL for uploaded files without relying on anonymous bucket reads or
// presigned-URL expiry — the server fetches from storage internally and streams.
const PREFIX = /^\/api\/public\/assets\//;

/** Uploads are stored under `projects/<projectId>/assets/...` (see actions/assets.ts),
 *  so the owning project is recoverable from the key — required to honour takedowns. */
const PROJECT_KEY = /^projects\/([^/]+)\/assets\//;

const app = new Hono<HonoEnv>().get('/*', ...assetRoutes.get, async (ctx) => {
  // Derive the object key from the path (Hono's wildcard param isn't reliable for
  // multi-segment keys); decode in case the browser percent-encoded segments.
  const key = decodeURIComponent(ctx.req.path.replace(PREFIX, ''));
  if (!key) {
    throw notFound('asset');
  }
  // Moderation: a taken-down project's hosted files (the usual phishing/DMCA
  // payload) must stop being served, not just its pages.
  const projectId = PROJECT_KEY.exec(key)?.[1];
  if (projectId && (await isProjectTakenDown(projectId))) {
    throw notFound('asset', { key });
  }
  const viewer = projectId ? await projectDeliveryAccess(projectId, ctx.req.raw.headers) : null;
  if (projectId && !viewer) {
    throw notFound('asset', { key });
  }
  const head = await headObject(key).catch(() => null);
  if (!head) {
    throw notFound('asset', { key });
  }
  const stream = await getObjectStream(key);
  const headers = publicAssetResponseHeaders(head.ContentType);
  ctx.header('Content-Type', headers.contentType);
  if (headers.contentDisposition) {
    ctx.header('Content-Disposition', headers.contentDisposition);
  }
  if (headers.contentSecurityPolicy) {
    ctx.header('Content-Security-Policy', headers.contentSecurityPolicy);
  }
  // Long-lived but NOT immutable: a taken-down asset must become unreachable in
  // caches within a day rather than being pinned for a year.
  // Reader/workspace responses vary by a private session cookie and must never
  // enter a shared cache. Public assets retain the historical one-day policy.
  for (const [name, value] of Object.entries(deliveryCacheHeaders(Boolean(viewer && viewer.kind !== 'public'), 'public, max-age=86400'))) {
    ctx.header(name, value);
  }
  return ctx.body(Readable.toWeb(stream) as ReadableStream);
});

export default app;
