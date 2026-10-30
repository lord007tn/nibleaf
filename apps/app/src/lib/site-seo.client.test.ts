// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canonicalSiteBase, sitePageUrl } from './site-seo';

beforeEach(() => {
  vi.stubEnv('VITE_SITE_BASE_DOMAIN', '');
  window.history.replaceState(null, '', '/guide');
  const marker = document.createElement('meta');
  marker.name = 'nibleaf-site-project';
  marker.content = 'p1';
  document.head.append(marker);
});

afterEach(() => {
  document.querySelector('meta[name="nibleaf-site-project"]')?.remove();
  window.history.replaceState(null, '', '/');
  vi.unstubAllEnvs();
});

it('keeps custom-domain canonical URLs at the document origin after client navigation', () => {
  expect(canonicalSiteBase('p1')).toBe(window.location.origin);
  expect(canonicalSiteBase('other')).toBe(`${window.location.origin}/sites/other`);
});

it('retains path-based preview canonicals even with the SSR project marker', () => {
  window.history.replaceState(null, '', '/sites/p1/guide');
  expect(canonicalSiteBase('p1')).toBe(`${window.location.origin}/sites/p1`);
});

it('preserves explicit primary-domain, subdomain, and SSR-origin precedence', () => {
  expect(canonicalSiteBase('p1', { primaryDomain: 'docs.example.com' })).toBe('https://docs.example.com');
  expect(canonicalSiteBase('p1', { slug: 'docs', baseDomain: 'example.com' })).toBe('https://docs.example.com');
  expect(canonicalSiteBase('p1', { requestOrigin: 'https://secondary.example.com' })).toBe('https://secondary.example.com');
});


it('serializes Arabic canonical paths once for custom domains', () => {
  const raw = 'reference/\u0627\u0644\u0628\u062f\u0627\u064a\u0629';
  const encoded = 'reference/%D8%A7%D9%84%D8%A8%D8%AF%D8%A7%D9%8A%D8%A9';
  expect(sitePageUrl('p1', raw, 'ar')).toBe(`${window.location.origin}/${encoded}?lang=ar`);
  expect(sitePageUrl('p1', encoded, 'ar')).toBe(`${window.location.origin}/${encoded}?lang=ar`);
});
