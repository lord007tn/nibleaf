import { describe, expect, it } from 'vitest';
import { publishedPageUrl, publishFailureDetails } from './deploy-pipeline';

const site = 'https://docs.example.com';
const options = { primaryDomain: 'docs.example.com' };

describe('publishedPageUrl', () => {
  it('keeps default-version addresses unchanged', () => {
    expect(publishedPageUrl('p1', { path: 'guides/getting-started', title: 'Start' }, options)).toBe(`${site}/guides/getting-started`);
    expect(publishedPageUrl('p1', { path: 'guides/getting-started', title: 'Start', languageCode: 'ar' }, options)).toBe(
      `${site}/guides/getting-started?lang=ar`,
    );
  });

  it('prefixes a non-default version as the first path segment', () => {
    expect(publishedPageUrl('p1', { path: 'getting-started', title: 'Start', versionSlug: 'v2' }, options)).toBe(`${site}/v2/getting-started`);
    expect(publishedPageUrl('p1', { path: 'getting-started', title: 'Start', versionSlug: 'v2', languageCode: 'pt-BR' }, options)).toBe(
      `${site}/v2/getting-started?lang=pt-BR`,
    );
  });

  it('encodes non-Latin page addresses segment by segment', () => {
    expect(publishedPageUrl('p1', { path: 'دليل/البداية', title: 'البداية', versionSlug: 'v2', languageCode: 'ar' }, options)).toBe(
      `${site}/v2/${encodeURIComponent('دليل')}/${encodeURIComponent('البداية')}?lang=ar`,
    );
  });

  it('uses the site address on its own subdomain when there is no custom domain', () => {
    expect(publishedPageUrl('p1', { path: 'start', title: 'Start' }, { slug: 'help', baseDomain: 'docs.test' })).toBe('https://help.docs.test/start');
  });
});

describe('publishFailureDetails', () => {
  it('lists each page check issue with the page it belongs to', () => {
    expect(
      publishFailureDetails({
        error: 'Publish checks failed',
        errorDetails: [
          { type: 'broken-link', pageTitle: 'Billing', pagePath: '/billing', detail: 'Link to /refunds goes nowhere' },
          { type: 'broken-link', pageTitle: 'Billing', pagePath: '/billing', detail: 'Link to /refunds goes nowhere' },
          { type: 'grammar', pageTitle: '', pagePath: '/start', detail: 'Repeated word' },
        ],
      }),
    ).toEqual(['Billing — Link to /refunds goes nowhere', '/start — Repeated word']);
  });

  it('falls back to the error text, and to nothing when the worker gave no reason', () => {
    expect(publishFailureDetails({ error: ' Invalid redirect: /a → /a ', errorDetails: null })).toEqual(['Invalid redirect: /a → /a']);
    expect(publishFailureDetails({ error: null, errorDetails: null })).toEqual([]);
    expect(publishFailureDetails(undefined)).toEqual([]);
  });
});

it('keeps owner links with language/content collisions on the server-resolved legacy form', () => {
  expect(publishedPageUrl('p1', { path: 'ar/guide', title: 'Guide', languageCode: 'ar' }, options)).toBe(`${site}/ar/guide?lang=ar`);
});
