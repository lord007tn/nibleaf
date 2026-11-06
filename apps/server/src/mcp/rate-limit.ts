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

/** A per-key fixed-window counter for one budget. Like the transport limiter it
 *  is instance-local and bounded; unlike it, every rejection is audited by the
 *  write runner, so there is no rejection-audit reservation. */
const createWriteBudget = (windowMs: number, limitFor: () => number) => {
  const budget = new Map<string, { count: number; resetAt: number }>();
  return (apiKeyId: string, now = Date.now()) => {
    const limit = limitFor();
    const current = budget.get(apiKeyId);
    if (!current && budget.size >= MAX_BUCKETS) {
      for (const [key, bucket] of budget) {
        if (bucket.resetAt <= now) budget.delete(key);
      }
    }
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    budget.delete(apiKeyId);
    budget.set(apiKeyId, bucket);
    if (budget.size > MAX_BUCKETS) {
      const oldest = budget.keys().next().value;
      if (oldest && oldest !== apiKeyId) budget.delete(oldest);
    }
    return { allowed: bucket.count <= limit, limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
  };
};

/** Budget shared by every MCP write tool call of one key (MCP_WRITE_RATE_LIMIT_PER_MIN). */
export const checkMcpWriteRateLimit = createWriteBudget(WINDOW_MS, () => env.MCP_WRITE_RATE_LIMIT_PER_MIN);

/** Budget for deployments created through `publish_changes` (MCP_PUBLISH_RATE_LIMIT_PER_HOUR). */
export const checkMcpPublishRateLimit = createWriteBudget(60 * WINDOW_MS, () => env.MCP_PUBLISH_RATE_LIMIT_PER_HOUR);
