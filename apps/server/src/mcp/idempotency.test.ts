import { describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/database', () => ({ prisma: {} }));

import { CLIENT_REQUEST_ID_PATTERN, hashMcpArguments } from './idempotency';

describe('MCP idempotency arguments', () => {
  it('hashes canonical arguments independent of key order and excluding the idempotency id', () => {
    const base = hashMcpArguments({ title: 'Refunds', nested: { b: 1, a: [1, { y: 2, x: 1 }] }, clientRequestId: 'retry-0001' });
    expect(hashMcpArguments({ nested: { a: [1, { x: 1, y: 2 }], b: 1 }, title: 'Refunds', clientRequestId: 'retry-9999' })).toBe(base);
    expect(hashMcpArguments({ title: 'Refunds', nested: { b: 1, a: [1, { y: 2, x: 1 }] }, extra: undefined })).toBe(base);
    expect(hashMcpArguments({ title: 'Refunds!', nested: { b: 1, a: [1, { y: 2, x: 1 }] } })).not.toBe(base);
    expect(hashMcpArguments({ title: 'Refunds', nested: { b: 1, a: [{ y: 2, x: 1 }, 1] } })).not.toBe(base);
  });

  it('accepts 8-128 safe characters as a clientRequestId', () => {
    for (const value of ['retry-01', 'a.b_c:d-e', 'x'.repeat(128)]) expect(CLIENT_REQUEST_ID_PATTERN.test(value)).toBe(true);
    for (const value of ['short', 'x'.repeat(129), 'has space1', 'semi;colon', 'ünicode-id'])
      expect(CLIENT_REQUEST_ID_PATTERN.test(value)).toBe(false);
  });
});
