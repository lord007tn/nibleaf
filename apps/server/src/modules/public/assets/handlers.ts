import { Readable } from 'node:stream';
import { getObjectStream, headObject } from '@nibleaf/storage';
import { Hono } from 'hono';
import { notFound } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import assetRoutes from './routes';

// Proxy stored assets through the API. This gives a stable, browser-reachable
// public URL for uploaded files without relying on anonymous bucket reads or
// presigned-URL expiry — the server fetches from storage internally and streams.
const PREFIX = /^\/api\/public\/assets\//;

const app = new Hono<HonoEnv>().get('/*', ...assetRoutes.get, async (ctx) => {
  // Derive the object key from the path (Hono's wildcard param isn't reliable for
  // multi-segment keys); decode in case the browser percent-encoded segments.
  const key = decodeURIComponent(ctx.req.path.replace(PREFIX, ''));
  if (!key) {
    throw notFound('asset');
  }
  const head = await headObject(key).catch(() => null);
  if (!head) {
    throw notFound('asset', { key });
  }
  const stream = await getObjectStream(key);
  ctx.header('Content-Type', head.ContentType ?? 'application/octet-stream');
  ctx.header('Cache-Control', 'public, max-age=31536000, immutable');
  return ctx.body(Readable.toWeb(stream) as ReadableStream);
});

export default app;
