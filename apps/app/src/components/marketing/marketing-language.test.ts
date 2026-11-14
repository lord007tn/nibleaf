/** Language links map page to page where a translation exists (MKT-002). */
import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { loadMarketingPage, marketingCounterpart } from './routes';

describe('marketingCounterpart', () => {
  it('maps a page to its translation when the site has one', () => {
    expect(marketingCounterpart('/')).toBe('/ar');
    expect(marketingCounterpart('/ar')).toBe('/');
    expect(marketingCounterpart('/guides')).toBe('/ar/guides');
    expect(marketingCounterpart('/ar/guides/')).toBe('/guides');
    expect(marketingCounterpart('/use-cases/api-docs')).toBe('/ar/use-cases/api-docs');
  });

  it('has none for a page that exists in one language only', () => {
    expect(marketingCounterpart('/pricing')).toBeNull();
  });
});

describe('Arabic addresses of English-only pages', () => {
  it('open the English page instead of a dead end', async () => {
    const outcome = await loadMarketingPage('/ar/pricing').catch((error: unknown) => error);
    expect(isRedirect(outcome)).toBe(true);
    expect((outcome as { options: { href?: string; statusCode?: number } }).options).toMatchObject({ href: '/pricing', statusCode: 307 });
  });
});
