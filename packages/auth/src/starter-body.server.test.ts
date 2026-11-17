import { describe, expect, it } from 'vitest';
import { normalizeStarterBody, starterBodyHash } from './starter-body.server';

describe('server-only starter body fingerprint', () => {
  it('uses SHA-256 of normalized UTF-8 Markdown', () => {
    expect(normalizeStarterBody(' \r\nhello\t world  ')).toBe('hello world');
    expect(starterBodyHash(' \r\nhello\t world  ')).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    expect(starterBodyHash('مرحبا')).toBe(starterBodyHash('\n مرحبا\r\n'));
    expect(starterBodyHash('hello world!')).not.toBe(starterBodyHash('hello world'));
  });
});
