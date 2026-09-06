import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCustomDomainSite, siteBasePath, siteHref } from './site-paths';

// site-origin reads the custom-domain origin the server entry stamped on the
// request; swap it for a controllable value so both serving modes are covered.
const origin = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('@/lib/site-origin', () => ({ customDomainOrigin: () => origin.value }));

afterEach(() => {
  origin.value = undefined;
});

describe('siteBasePath', () => {
  it('hangs app-origin sites off /sites/:projectId and custom domains off the root', () => {
    expect(siteBasePath('p1', false)).toBe('/sites/p1');
    expect(siteBasePath('p1', true)).toBe('');
  });
});

describe('siteHref', () => {
  it('builds app-origin hrefs with the language and version carried along', () => {
    expect(siteHref('p1')).toBe('/sites/p1');
    expect(siteHref('p1', '/guides/intro/')).toBe('/sites/p1/guides/intro');
    expect(siteHref('p1', 'guides/intro', { lang: 'ar' })).toBe('/sites/p1/guides/intro?lang=ar');
    expect(siteHref('p1', 'guides/intro', { lang: 'ar', version: 'v2' })).toBe('/sites/p1/v2/guides/intro?lang=ar');
    expect(siteHref('p1', '', { version: 'v2' })).toBe('/sites/p1/v2');
  });

  it('percent-encodes non-ASCII path segments exactly once', () => {
    expect(siteHref('p1', 'الأدلة/المصادقة', { lang: 'ar' })).toBe(
      '/sites/p1/%D8%A7%D9%84%D8%A3%D8%AF%D9%84%D8%A9/%D8%A7%D9%84%D9%85%D8%B5%D8%A7%D8%AF%D9%82%D8%A9?lang=ar',
    );
    // An authored link that is already encoded is not encoded a second time.
    expect(siteHref('p1', '/%D8%A7%D9%84%D9%85%D8%B5%D8%A7%D8%AF%D9%82%D8%A9', { lang: 'ar' })).toBe(
      '/sites/p1/%D8%A7%D9%84%D9%85%D8%B5%D8%A7%D8%AF%D9%82%D8%A9?lang=ar',
    );
    expect(siteHref('p1', 'api-الوصول', { version: 'v2' })).toBe('/sites/p1/v2/api-%D8%A7%D9%84%D9%88%D8%B5%D9%88%D9%84');
  });

  it('keeps authored anchors and query strings outside the encoded pathname', () => {
    expect(siteHref('p1', '/guides/intro#setup', { lang: 'ar' })).toBe('/sites/p1/guides/intro?lang=ar#setup');
    expect(siteHref('p1', '/المصادقة#الرموز')).toBe('/sites/p1/%D8%A7%D9%84%D9%85%D8%B5%D8%A7%D8%AF%D9%82%D8%A9#الرموز');
    expect(siteHref('p1', '/guides?tab=cli', { lang: 'ar' })).toBe('/sites/p1/guides?tab=cli&lang=ar');
    expect(siteHref('p1', '/guides?tab=cli')).toBe('/sites/p1/guides?tab=cli');
  });

  it('uses the domain root when the request arrived on a custom domain', () => {
    origin.value = 'https://docs.acme.com';
    expect(isCustomDomainSite('p1')).toBe(true);
    expect(siteHref('p1')).toBe('/');
    expect(siteHref('p1', 'guides/intro', { lang: 'ar' })).toBe('/guides/intro?lang=ar');
  });

  it('treats a server request without a stamped origin as app-origin serving', () => {
    expect(isCustomDomainSite('p1')).toBe(false);
    expect(siteHref('p1', 'guides')).toBe('/sites/p1/guides');
  });
});
