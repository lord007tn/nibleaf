import { env } from '@/env';

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export const checkMcpRateLimit = (apiKeyId: string, now = Date.now()) => {
  const current = buckets.get(apiKeyId);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + WINDOW_MS };
  bucket.count += 1;
  buckets.set(apiKeyId, bucket);
  if (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }
  return {
    allowed: bucket.count <= env.MCP_RATE_LIMIT_PER_MIN,
    limit: env.MCP_RATE_LIMIT_PER_MIN,
    remaining: Math.max(0, env.MCP_RATE_LIMIT_PER_MIN - bucket.count),
    resetAt: bucket.resetAt,
  };
};
