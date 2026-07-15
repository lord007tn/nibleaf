import { describe, expect, it } from 'vitest';
import { rewriteCustomDomainInput, rewriteCustomDomainOutput } from './custom-domain-rewrite';

describe('custom-domain router rewrites', () => {
  const projectId = 'project-123';

  it('maps public custom-domain paths to the internal published-site route', () => {
    expect(rewriteCustomDomainInput(new URL('https://docs.example.com/'), projectId).href).toBe('https://docs.example.com/sites/project-123');
    expect(rewriteCustomDomainInput(new URL('https://docs.example.com/guides/start?lang=ar'), projectId).href).toBe(
      'https://docs.example.com/sites/project-123/guides/start?lang=ar',
    );
  });

  it('does not double-prefix an internal route', () => {
    expect(rewriteCustomDomainInput(new URL('https://docs.example.com/sites/project-123/welcome'), projectId).pathname).toBe(
      '/sites/project-123/welcome',
    );
  });

  it('maps internal router hrefs back to clean public paths', () => {
    expect(rewriteCustomDomainOutput(new URL('https://docs.example.com/sites/project-123'), projectId).pathname).toBe('/');
    expect(rewriteCustomDomainOutput(new URL('https://docs.example.com/sites/project-123/welcome?lang=en'), projectId).href).toBe(
      'https://docs.example.com/welcome?lang=en',
    );
  });
});
