import { describe, expect, it } from 'vitest';
import { buildSiteRedirectHref } from './site-redirect-href';

describe('buildSiteRedirectHref', () => {
  it('preserves configured query and fragment under the app base path', () => {
    expect(buildSiteRedirectHref({ projectId: 'project-1', target: '/guide?campaign=launch#install', lang: 'ar', customDomain: false })).toBe(
      '/sites/project-1/ar/guide?campaign=launch#install',
    );
  });

  it('keeps an explicitly selected locale and uses the custom-domain root', () => {
    expect(buildSiteRedirectHref({ projectId: 'project-1', target: '/guide?lang=en#top', lang: 'ar', customDomain: true })).toBe('/en/guide#top');
  });

  it('omits an explicitly selected default language', () => {
    expect(
      buildSiteRedirectHref({ projectId: 'project-1', target: '/guide?lang=en#top', lang: 'ar', customDomain: true, defaultLanguage: 'en' }),
    ).toBe('/guide#top');
  });

  it('normalizes trailing slashes and handles the site root', () => {
    expect(buildSiteRedirectHref({ projectId: 'project-1', target: '/guide///', customDomain: false })).toBe('/sites/project-1/guide');
    expect(buildSiteRedirectHref({ projectId: 'project-1', target: '/', customDomain: false })).toBe('/sites/project-1');
  });
});
