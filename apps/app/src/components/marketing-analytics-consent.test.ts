// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GTM_MARKETING_EVENT, MARKETING_ANALYTICS_CONSENT_KEY, suspendMarketingAnalytics } from '@/lib/marketing-analytics';

const GTM_TARGET = { id: 'GTM-ABC123', provider: 'gtm' } as const;

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
  let queryClient: QueryClient;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['public', 'meta'], {
      marketingAnalytics: { consentRequired: true, ga4MeasurementId: null, gtmContainerId: 'GTM-ABC123' },
      providers: { google: false },
      signupDisabled: false,
    });
    window.localStorage.clear();
  });

  afterEach(() => {
    suspendMarketingAnalytics(GTM_TARGET);
    act(() => root.unmount());
    container.remove();
    document.head.querySelector('#nibleaf-marketing-gtm')?.remove();
    window.localStorage.clear();
    Reflect.deleteProperty(window, 'dataLayer');
    Reflect.deleteProperty(window, 'gtag');
    vi.unstubAllGlobals();
  });

  it('keeps Google unloaded until the Arabic visitor accepts', async () => {
    const renderConsent = () =>
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(MarketingAnalyticsConsent, { enabled: true, language: 'ar' })),
      );
    await act(async () => renderConsent());

    expect(container.textContent).toContain('تحليلات اختيارية');
    expect(document.querySelector('#nibleaf-marketing-gtm')).toBeNull();

    const accept = [...container.querySelectorAll('button')].find((button) => button.textContent === 'قبول التحليلات');
    await act(async () => accept?.click());

    expect(window.localStorage.getItem(MARKETING_ANALYTICS_CONSENT_KEY)).toBe('accepted');
    expect(document.querySelector('#nibleaf-marketing-gtm')).not.toBeNull();

    await act(async () => renderConsent());
    const pageViews = window.dataLayer?.filter(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        !Array.isArray(entry) &&
        Object.prototype.toString.call(entry) !== '[object Arguments]' &&
        (entry as Record<string, unknown>).event === GTM_MARKETING_EVENT &&
        (entry as Record<string, unknown>).event_name === 'page_view',
    );
    expect(pageViews).toHaveLength(1);
  });
});
