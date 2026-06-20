import type { MiddlewareHandler } from 'hono';
import { env } from '@/env';
import type { HonoEnv } from '@/lib/hono/context';

/** Apply baseline security response headers (HSTS only in production over TLS). */
export const securityHeaders =
  (): MiddlewareHandler<HonoEnv> =>
  async (ctx, next) => {
    await next();
    ctx.header('X-Content-Type-Options', 'nosniff');
    ctx.header('X-Frame-Options', 'DENY');
    ctx.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (env.NODE_ENV === 'production') {
      ctx.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  };
