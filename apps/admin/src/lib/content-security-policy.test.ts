import { describe, expect, it } from 'vitest';
import { adminContentSecurityPolicy } from './content-security-policy';

describe('adminContentSecurityPolicy', () => {
  it('requires nonced scripts and prevents every embedding origin', () => {
    const policy = adminContentSecurityPolicy('test-nonce');

    expect(policy).toContain("script-src 'self' 'nonce-test-nonce'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });
});
