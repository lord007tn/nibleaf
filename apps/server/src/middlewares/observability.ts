import { logger } from '@plume/logger';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';

/** Emit one canonical log line per request with method, path, status, and duration. */
export const observabilityMiddleware =
  (): MiddlewareHandler<HonoEnv> =>
  async (ctx, next) => {
    const start = performance.now();
    await next();
    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    logger.info(
      {
        requestId: ctx.get('requestId'),
        method: ctx.req.method,
        path: ctx.req.path,
        status: ctx.res.status,
        durationMs,
      },
      'request',
    );
  };
