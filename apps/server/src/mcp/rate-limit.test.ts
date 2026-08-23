import { describe, expect, it, vi } from 'vitest';
import { checkMcpRateLimit } from './rate-limit';

vi.mock('@/env', () => ({ env: { MCP_RATE_LIMIT_PER_MIN: 2 } }));

describe('MCP instance-local limiter', () => {
  it('limits each API key independently within a bounded one-minute window', () => {
    const now = Date.now();
    const key = `key-${now}`;
    expect(checkMcpRateLimit(key, now)).toMatchObject({ allowed: true, limit: 2, remaining: 1 });
    expect(checkMcpRateLimit(key, now + 1)).toMatchObject({ allowed: true, limit: 2, remaining: 0 });
    expect(checkMcpRateLimit(key, now + 2)).toMatchObject({ allowed: false, limit: 2, remaining: 0 });
    expect(checkMcpRateLimit(`${key}-other`, now + 2)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('opens a fresh bucket after the local window expires', () => {
    const now = Date.now();
    const key = `reset-${now}`;
    const first = checkMcpRateLimit(key, now);
    expect(checkMcpRateLimit(key, first.resetAt)).toMatchObject({ allowed: true, remaining: 1 });
  });
});
