import { logger } from '@nibleaf/logger';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';

/** Join-link tokens are credentials (only their hash is stored), so the path
 *  logged for /join/:token keeps the route shape and drops the token. */
export const loggablePath = (path: string) =>
  path.replace(/\/join\/nlj_[A-Za-z0-9_-]+/g, '/join/[token]').replace(/\/assets\/upload\/[^/]+/g, '/assets/upload/[token]');

/** Emit one canonical log line per request with method, path, status, and duration. */
export const observabilityMiddleware = (): MiddlewareHandler<HonoEnv> => async (ctx, next) => {
  const start = performance.now();
  await next();
  const durationMs = Math.round((performance.now() - start) * 100) / 100;
  logger.info(
    {
      requestId: ctx.get('requestId'),
      method: ctx.req.method,
      path: loggablePath(ctx.req.path),
      status: ctx.res.status,
      durationMs,
    },
    'request',
  );
};
