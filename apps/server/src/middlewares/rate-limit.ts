import { timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { AppError } from '@/errors';
import { clientIpFromForwardedFor, isPrivateIp } from '@/lib/client-ip';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';

interface RateLimitOptions {
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed per client within the window. */
  max: number;
}

/** Hard bound on distinct client buckets kept in memory per limiter instance —
 *  a spoofed-IP flood evicts the oldest buckets instead of growing the heap. */
const MAX_TRACKED_KEYS = 10_000;

/** Constant-time secret comparison — `===` short-circuits on the first differing
 *  byte, leaking a timing oracle on a value that gates a trust decision. */
const secretMatches = (candidate: string | undefined, secret: string): boolean => {
  if (!candidate) {
    return false;
  }
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The direct TCP peer of this request, or null when the runtime exposes no
 *  socket info (e.g. tests invoking app.fetch directly). */
const socketAddress = (ctx: Context<HonoEnv>): string | null => {
  try {
    return getConnInfo(ctx).remote.address ?? null;
  } catch {
    return null;
  }
};

/**
 * Resolve the rate-limit bucket key for a request. Priority:
 *  1. `x-nibleaf-client-ip` — set by our own app SSR proxy, which knows the
 *     real visitor IP (SSR loader fetches otherwise all originate from the app
 *     container's address and would share one bucket). The app's nitro /api
 *     proxy forwards browser-supplied headers, so a private peer alone is NOT
 *     proof the hint came from our SSR code — the hint is only honoured when
 *     INTERNAL_API_SECRET is configured AND the request carries the matching
 *     `x-nibleaf-internal` header (plus a private direct peer).
 *  2. `x-forwarded-for` — first public hop (see lib/client-ip.ts).
 *  3. The actual socket remote address (direct connections / dev).
 * Never a shared constant: worst case is 'unknown', which only happens when a
 * runtime has neither headers nor socket info.
 */
export const resolveClientKey = (ctx: Context<HonoEnv>): string => {
  const peer = socketAddress(ctx);
  const hinted = ctx.req.header('x-nibleaf-client-ip')?.trim();
  const secret = envExtras.INTERNAL_API_SECRET;
  const trustedInternal = Boolean(secret) && secretMatches(ctx.req.header('x-nibleaf-internal'), secret as string);
  if (hinted && trustedInternal && peer && isPrivateIp(peer)) {
    return hinted;
  }
  const forwarded = clientIpFromForwardedFor(ctx.req.header('x-forwarded-for'), envExtras.TRUSTED_PROXY_HOPS);
  if (forwarded) {
    return forwarded;
  }
  return peer ?? 'unknown';
};

/**
 * Lightweight in-memory sliding-window rate limiter (no external deps).
 *
 * NOTE: state is per-instance — behind multiple replicas each process tracks its
 * own counters, so the effective limit scales with instance count. Use a
 * Redis-backed limiter for accurate enforcement across a multi-instance deployment.
 */
export const rateLimit = ({ windowMs, max }: RateLimitOptions): MiddlewareHandler<HonoEnv> => {
  const hits = new Map<string, number[]>();

  // Periodically drop buckets with no in-window activity so idle clients don't
  // accumulate forever. unref() keeps the timer from holding the process open.
  const sweep = () => {
    const cutoff = Date.now() - windowMs;
    for (const [key, stamps] of hits) {
      if ((stamps[stamps.length - 1] ?? 0) <= cutoff) {
        hits.delete(key);
      }
    }
  };
  setInterval(sweep, Math.max(windowMs, 30_000)).unref();

  return async (ctx, next) => {
    const key = resolveClientKey(ctx);
    const now = Date.now();
    const cutoff = now - windowMs;

    // Bound the map even between sweeps: evict the oldest-tracked bucket, not the new one.
    if (!hits.has(key) && hits.size >= MAX_TRACKED_KEYS) {
      const oldest = hits.keys().next();
      if (!oldest.done) {
        hits.delete(oldest.value);
      }
    }

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
