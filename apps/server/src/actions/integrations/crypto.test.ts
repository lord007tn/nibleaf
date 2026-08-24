import { describe, expect, it } from 'vitest';
import { decryptIntegrationSecret, digestIntegrationValue, digestIntegrationValueCandidates, encryptIntegrationSecret } from './crypto';

const first = Buffer.alloc(32, 7).toString('base64');
const second = Buffer.alloc(32, 9).toString('base64');

describe('integration credential envelopes', () => {
  it('round-trips without placing plaintext in the envelope', () => {
    const envelope = encryptIntegrationSecret('https://hooks.example.test/secret', { current: first });
    expect(envelope).not.toContain('hooks.example.test');
    expect(decryptIntegrationSecret(envelope, { current: first })).toBe('https://hooks.example.test/secret');
  });

  it('supports decrypt-only previous keys during rotation', () => {
    const envelope = encryptIntegrationSecret('secret', { current: first });
    expect(decryptIntegrationSecret(envelope, { current: second, previous: [first] })).toBe('secret');
    expect(() => decryptIntegrationSecret(envelope, { current: second })).toThrow('key is unavailable');
  });

  it('stores deterministic HMAC digests rather than caller keys', () => {
    const digest = digestIntegrationValue('client-idempotency-key', 'idempotency-key', { current: first });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain('client-idempotency-key');
  });

  it('keeps prior digests discoverable during key rotation', () => {
    const prior = digestIntegrationValue('one-time-value', 'confirmation', { current: first });
    const candidates = digestIntegrationValueCandidates('one-time-value', 'confirmation', {
      current: second,
      previous: [first],
    });
    expect(candidates).toContain(prior);
    expect(candidates[0]).not.toBe(prior);
  });

  it('separates digest purposes', () => {
    const options = { current: first };
    expect(digestIntegrationValue('same', 'confirmation', options)).not.toBe(digestIntegrationValue('same', 'idempotency-key', options));
  });
});
