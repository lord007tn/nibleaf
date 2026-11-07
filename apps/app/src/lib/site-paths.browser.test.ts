// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { isCustomDomainSite } from './site-paths';

vi.mock('@/lib/site-origin', () => ({ customDomainOrigin: () => undefined }));

const at = (pathname: string) => {
  window.history.replaceState(null, '', pathname);
  return isCustomDomainSite('p1');
};

describe('app-owned paths in the browser', () => {
  it.each(['/git-preview', '/git-preview/token', '/app', '/app/projects', '/sign-in'])('treats %s as the app origin', (pathname) => {
    expect(at(pathname)).toBe(false);
  });

  it.each(['/git-preview-guide', '/app-guide', '/sign-in-help'])('treats published page %s on a custom domain as the site', (pathname) => {
    expect(at(pathname)).toBe(true);
  });
});
