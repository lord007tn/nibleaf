import { describe, expect, it, vi } from 'vitest';
import { checkMcpPublishRateLimit, checkMcpRateLimit, checkMcpWriteRateLimit, finalizeMcpRateLimitRejectionAudit } from './rate-limit';

vi.mock('@/env', () => ({ env: { MCP_RATE_LIMIT_PER_MIN: 2, MCP_WRITE_RATE_LIMIT_PER_MIN: 3, MCP_PUBLISH_RATE_LIMIT_PER_HOUR: 1 } }));

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

describe('MCP write and publish budgets', () => {
  it('limits write calls per key per minute, independently of other keys', () => {
    const now = Date.now();
    const key = `writer-${now}`;
    for (let call = 0; call < 3; call += 1) expect(checkMcpWriteRateLimit(key, now + call)).toMatchObject({ allowed: true, limit: 3 });
    expect(checkMcpWriteRateLimit(key, now + 3)).toMatchObject({ allowed: false, remaining: 0, resetAt: now + 60_000 });
    expect(checkMcpWriteRateLimit(`${key}-other`, now + 3)).toMatchObject({ allowed: true });
    expect(checkMcpWriteRateLimit(key, now + 60_000)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it('limits publishes per key per hour', () => {
    const now = Date.now();
    const key = `publisher-${now}`;
    expect(checkMcpPublishRateLimit(key, now)).toMatchObject({ allowed: true, limit: 1 });
    expect(checkMcpPublishRateLimit(key, now + 59 * 60_000)).toMatchObject({ allowed: false, resetAt: now + 3_600_000 });
    expect(checkMcpPublishRateLimit(key, now + 3_600_000)).toMatchObject({ allowed: true });
  });
});
