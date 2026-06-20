import type { MiddlewareHandler } from 'hono';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

interface RateLimitOptions {
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed per client within the window. */
  max: number;
}

const clientIp = (ctx: { req: { header: (name: string) => string | undefined } }): string =>
  ctx.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

/**
 * Lightweight in-memory sliding-window rate limiter (no external deps).
 *
 * NOTE: state is per-instance — behind multiple replicas each process tracks its
 * own counters, so the effective limit scales with instance count. Use a
 * Redis-backed limiter for accurate enforcement across a multi-instance deployment.
 */
export const rateLimit = ({ windowMs, max }: RateLimitOptions): MiddlewareHandler<HonoEnv> => {
  const hits = new Map<string, number[]>();

  return async (ctx, next) => {
    const key = clientIp(ctx);
    const now = Date.now();
    const cutoff = now - windowMs;

    const recent = (hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= max) {
      hits.set(key, recent);
      throw new AppError({ code: 'http:rate_limited', message: 'Too many requests, please slow down.' });
    }

    recent.push(now);
    hits.set(key, recent);

    await next();
  };
};
