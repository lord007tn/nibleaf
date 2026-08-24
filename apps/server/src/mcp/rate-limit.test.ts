import { describe, expect, it, vi } from 'vitest';
import { checkMcpRateLimit, finalizeMcpRateLimitRejectionAudit } from './rate-limit';

vi.mock('@/env', () => ({ env: { MCP_RATE_LIMIT_PER_MIN: 2 } }));

describe('MCP instance-local limiter', () => {
  it('limits each API key independently within a bounded one-minute window', () => {
    const now = Date.now();
    const key = `key-${now}`;
    expect(checkMcpRateLimit(key, now)).toMatchObject({ allowed: true, limit: 2, remaining: 1 });
    expect(checkMcpRateLimit(key, now + 1)).toMatchObject({ allowed: true, limit: 2, remaining: 0 });
    const rejected = checkMcpRateLimit(key, now + 2);
    expect(rejected).toMatchObject({ allowed: false, limit: 2, remaining: 0, shouldAuditRejection: true });
    expect(checkMcpRateLimit(key, now + 3)).toMatchObject({ allowed: false, shouldAuditRejection: false, auditPending: true });
    finalizeMcpRateLimitRejectionAudit(key, rejected.resetAt, true);
    expect(checkMcpRateLimit(key, now + 4)).toMatchObject({ allowed: false, shouldAuditRejection: false, auditPending: false });
    expect(checkMcpRateLimit(`${key}-other`, now + 2)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('releases a failed rejection-audit reservation so the next request retries it', () => {
    const now = Date.now();
    const key = `audit-retry-${now}`;
    checkMcpRateLimit(key, now);
    checkMcpRateLimit(key, now + 1);
    const firstRejection = checkMcpRateLimit(key, now + 2);
    expect(firstRejection.shouldAuditRejection).toBe(true);

    finalizeMcpRateLimitRejectionAudit(key, firstRejection.resetAt, false);
    const retriedRejection = checkMcpRateLimit(key, now + 3);
    expect(retriedRejection).toMatchObject({ allowed: false, shouldAuditRejection: true, resetAt: firstRejection.resetAt });
  });

  it('marks concurrent rejections audit-pending until the reservation is finalized', () => {
    const now = Date.now();
    const key = `audit-pending-${now}`;
    checkMcpRateLimit(key, now);
    checkMcpRateLimit(key, now + 1);
    const reserved = checkMcpRateLimit(key, now + 2);
    expect(reserved).toMatchObject({ shouldAuditRejection: true, auditPending: false });

    expect(checkMcpRateLimit(key, now + 3)).toMatchObject({ allowed: false, shouldAuditRejection: false, auditPending: true });
    finalizeMcpRateLimitRejectionAudit(key, reserved.resetAt, true);
    expect(checkMcpRateLimit(key, now + 4)).toMatchObject({ allowed: false, shouldAuditRejection: false, auditPending: false });
  });

  it('opens a fresh bucket after the local window expires', () => {
    const now = Date.now();
    const key = `reset-${now}`;
    const first = checkMcpRateLimit(key, now);
    expect(checkMcpRateLimit(key, first.resetAt)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('purges expired buckets before bounded-cap eviction and preserves the current request bucket', () => {
    const expiredAt = Date.now() - 120_000;
    for (let index = 0; index < 10_000; index += 1) checkMcpRateLimit(`expired-${expiredAt}-${index}`, expiredAt);

    const now = Date.now();
    const currentKey = `current-${now}`;
    expect(checkMcpRateLimit(currentKey, now)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkMcpRateLimit(currentKey, now + 1)).toMatchObject({ allowed: true, remaining: 0 });
  });
});
