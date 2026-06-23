import { describe, expect, it } from 'vitest';
import { hashApiKeySecret, safeEqual, signPayload } from './crypto';

describe('hashApiKeySecret', () => {
  it('is a stable 64-char hex SHA-256', () => {
    const hash = hashApiKeySecret('s3cret');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKeySecret('s3cret')).toBe(hash);
    expect(hashApiKeySecret('other')).not.toBe(hash);
  });
});

describe('signPayload', () => {
  it('produces a deterministic hex HMAC keyed by the secret', () => {
    const sig = signPayload('{"a":1}', 'key');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(signPayload('{"a":1}', 'key')).toBe(sig);
    expect(signPayload('{"a":1}', 'other')).not.toBe(sig);
  });
});

describe('safeEqual', () => {
  it('returns true for equal strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
  it('returns false for equal-length but different strings', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
  });
  it('returns false without throwing for different lengths', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
