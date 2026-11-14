/** Language links map page to page where a translation exists (MKT-002). */
import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';
import { loadMarketingPage, marketingCounterpart } from './routes';

vi.mock('@/functions/marketing', () => ({ getGithubStarsFn: vi.fn(async () => 7) }));

describe('marketingCounterpart', () => {
  it('maps a page to its translation when the site has one', () => {
    expect(marketingCounterpart('/')).toBe('/ar');
    expect(marketingCounterpart('/ar')).toBe('/');
    expect(marketingCounterpart('/guides')).toBe('/ar/guides');
    expect(marketingCounterpart('/ar/guides/')).toBe('/guides');
    expect(marketingCounterpart('/use-cases/api-docs')).toBe('/ar/use-cases/api-docs');
  });

  it('maps pricing and self-hosting both ways', () => {
    expect(marketingCounterpart('/pricing')).toBe('/ar/pricing');
    expect(marketingCounterpart('/ar/pricing')).toBe('/pricing');
    expect(marketingCounterpart('/self-hosting/')).toBe('/ar/self-hosting');
    expect(marketingCounterpart('/ar/self-hosting')).toBe('/self-hosting');
  });

  it('has none for a page that exists in one language only', () => {
    expect(marketingCounterpart('/cloud')).toBeNull();
    expect(marketingCounterpart('/about')).toBeNull();
  });
});

describe('Arabic addresses', () => {
  it.each(['/ar/cloud', '/ar/about', '/ar/compare/nibleaf-vs-mintlify'])('%s, a page only in English, opens the English page', async (path) => {
    const outcome = await loadMarketingPage(path).catch((error: unknown) => error);
    expect(isRedirect(outcome)).toBe(true);
    expect((outcome as { options: { href?: string; statusCode?: number } }).options).toMatchObject({ href: path.slice(3), statusCode: 307 });
  });

  it.each(['/ar/pricing', '/ar/self-hosting'])('%s renders its own Arabic page instead of redirecting', async (path) => {
    const data = await loadMarketingPage(path);
    expect(data.marketingPath).toBe(path);
  });
});
