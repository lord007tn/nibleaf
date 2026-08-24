import { env } from '@/env';

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const buckets = new Map<
  string,
  {
    count: number;
    resetAt: number;
    rejectionAuditState: 'idle' | 'reserved' | 'audited';
  }
>();

const removeExpiredBuckets = (now: number) => {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

export const checkMcpRateLimit = (apiKeyId: string, now = Date.now()) => {
  const current = buckets.get(apiKeyId);
  if (current && current.resetAt <= now) buckets.delete(apiKeyId);
  if (!current && buckets.size >= MAX_BUCKETS) removeExpiredBuckets(now);

  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + WINDOW_MS, rejectionAuditState: 'idle' as const };
  bucket.count += 1;
  const allowed = bucket.count <= env.MCP_RATE_LIMIT_PER_MIN;
  const shouldAuditRejection = !allowed && bucket.rejectionAuditState === 'idle';
  const auditPending = !allowed && bucket.rejectionAuditState === 'reserved';
  if (shouldAuditRejection) bucket.rejectionAuditState = 'reserved';

  // Refresh insertion order so a frequently used key is not selected as the
  // bounded map's oldest entry when a new key arrives.
  buckets.delete(apiKeyId);
  buckets.set(apiKeyId, bucket);
  if (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest && oldest !== apiKeyId) buckets.delete(oldest);
  }
  return {
    allowed,
    limit: env.MCP_RATE_LIMIT_PER_MIN,
    remaining: Math.max(0, env.MCP_RATE_LIMIT_PER_MIN - bucket.count),
    resetAt: bucket.resetAt,
    shouldAuditRejection,
    auditPending,
  };
};

export const finalizeMcpRateLimitRejectionAudit = (apiKeyId: string, resetAt: number, succeeded: boolean) => {
  const bucket = buckets.get(apiKeyId);
  if (!bucket || bucket.resetAt !== resetAt || bucket.rejectionAuditState !== 'reserved') return;
  bucket.rejectionAuditState = succeeded ? 'audited' : 'idle';
};
