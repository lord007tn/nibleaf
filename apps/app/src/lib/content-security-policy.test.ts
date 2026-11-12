import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './content-security-policy';

describe('contentSecurityPolicy', () => {
  it('allows only nonced inline scripts while preserving required integrations', () => {
    const policy = contentSecurityPolicy('test-nonce');

    expect(policy).toContain(
      "script-src 'self' 'nonce-test-nonce' https://static.cloudflareinsights.com https://www.googletagmanager.com https://plausible.io",
    );
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(policy).toContain("connect-src 'self' https: http:");
  });

  it('frames only the allowlisted video players', () => {
    const directives = contentSecurityPolicy('n').split('; ');
    expect(directives.filter((directive) => directive.startsWith('frame-src'))).toEqual([
      "frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com https://fast.wistia.net",
    ]);
    // Everything else is unchanged: no wildcard frames, no child-src fallback.
    expect(directives).not.toContain('child-src');
    expect(contentSecurityPolicy(['sha256-abc'])).toContain("frame-src 'self' https://www.youtube-nocookie.com");
    expect(directives[0]).toBe("default-src 'self'");
  });

  it('locks down embedding, plugins, and base URLs without breaking HTTP deployments', () => {
    const policy = contentSecurityPolicy('another-nonce');

    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).not.toContain('upgrade-insecure-requests');
  });
});
