// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETING_ANALYTICS_CONSENT_KEY, suspendMarketingAnalytics } from '@/lib/marketing-analytics';

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) => select({ location: { pathname: '/ar' } }),
}));

import { MarketingAnalyticsConsent, marketingAnalyticsEnabled } from './marketing-analytics-consent';

describe('marketingAnalyticsEnabled', () => {
  it('covers public marketing and sign-up routes without tracking private product surfaces', () => {
    expect(marketingAnalyticsEnabled('/ar')).toBe(true);
    expect(marketingAnalyticsEnabled('/ar/documentation-platforms')).toBe(true);
    expect(marketingAnalyticsEnabled('/sign-up')).toBe(true);
    expect(marketingAnalyticsEnabled('/privacy')).toBe(true);
    expect(marketingAnalyticsEnabled('/app')).toBe(false);
    expect(marketingAnalyticsEnabled('/app/projects/project')).toBe(false);
    expect(marketingAnalyticsEnabled('/sites/project/page', 'project')).toBe(false);
    expect(marketingAnalyticsEnabled('/accept-invite/token')).toBe(false);
  });
});

describe('MarketingAnalyticsConsent', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    window.localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { marketingAnalytics: { consentRequired: true, ga4MeasurementId: 'G-ABC123' } } }), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
      ),
    );
  });

  afterEach(() => {
    suspendMarketingAnalytics('G-ABC123');
    act(() => root.unmount());
    container.remove();
    document.head.querySelector('#nibleaf-marketing-ga4')?.remove();
    window.localStorage.clear();
    Reflect.deleteProperty(window, 'dataLayer');
    Reflect.deleteProperty(window, 'gtag');
    Reflect.deleteProperty(window, 'ga-disable-G-ABC123');
    vi.unstubAllGlobals();
  });

  it('keeps Google unloaded until the Arabic visitor accepts', async () => {
    await act(async () => root.render(createElement(MarketingAnalyticsConsent, { enabled: true, language: 'ar' })));

    expect(container.textContent).toContain('تحليلات اختيارية');
    expect(document.querySelector('#nibleaf-marketing-ga4')).toBeNull();

    const accept = [...container.querySelectorAll('button')].find((button) => button.textContent === 'قبول التحليلات');
    await act(async () => accept?.click());

    expect(window.localStorage.getItem(MARKETING_ANALYTICS_CONSENT_KEY)).toBe('accepted');
    expect(document.querySelector('#nibleaf-marketing-ga4')).not.toBeNull();
  });
});
