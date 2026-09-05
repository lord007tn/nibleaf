// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GTM_MARKETING_EVENT,
  MARKETING_ANALYTICS_CONSENT_KEY,
  sendMarketingAnalyticsEvent,
  suspendMarketingAnalytics,
} from '@/lib/marketing-analytics';

const GTM_TARGET = { id: 'GTM-ABC123', provider: 'gtm' } as const;
const route = vi.hoisted(() => ({ pathname: '/ar' }));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) => select({ location: route }),
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
    route.pathname = '/ar';
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
        entry instanceof Object &&
        !Array.isArray(entry) &&
        Object.prototype.toString.call(entry) !== '[object Arguments]' &&
        (entry as Record<string, unknown>).event === GTM_MARKETING_EVENT &&
        (entry as Record<string, unknown>).event_name === 'page_view',
    );
    expect(pageViews).toHaveLength(1);
  });

  it('suspends delivery when navigation unmounts the marketing boundary', async () => {
    window.localStorage.setItem(MARKETING_ANALYTICS_CONSENT_KEY, 'accepted');
    await act(async () =>
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(MarketingAnalyticsConsent, { enabled: true, language: 'en' })),
      ),
    );
    await act(async () => root.render(null));
    const before = window.dataLayer?.length;
    sendMarketingAnalyticsEvent('free_tool_cta_clicked', {
      product: 'nibleaf',
      tool_slug: 'rtl-documentation-readiness',
      destination: 'sample_project_signup',
      placement: 'result_bridge',
    });
    expect(window.dataLayer).toHaveLength(before ?? 0);
  });

  it('counts same-page regrant once without counting preference reopening or ordinary rerenders', async () => {
    const render = () =>
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(MarketingAnalyticsConsent, { enabled: true, language: 'en' })),
      );
    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label);
      expect(button).toBeDefined();
      await act(async () => button?.click());
    };
    const views = () =>
      (window.dataLayer ?? []).filter((entry) => entry instanceof Object && 'event_name' in entry && entry.event_name === 'page_view');
    await act(async () => render());
    await click('Accept analytics');
    expect(views()).toHaveLength(1);
    const commandsBeforePreferences = window.dataLayer?.length;
    await click('Privacy choices');
    expect(window.dataLayer).toHaveLength(commandsBeforePreferences ?? 0);
    await click('Accept analytics');
    await act(async () => render());
    expect(views()).toHaveLength(1);
    await click('Privacy choices');
    await click('Decline');
    await click('Privacy choices');
    await click('Accept analytics');
    expect(views()).toHaveLength(2);
    await act(async () => render());
    expect(views()).toHaveLength(2);
  });

  it('tracks SPA path changes once and stops after withdrawal in another tab', async () => {
    window.localStorage.setItem(MARKETING_ANALYTICS_CONSENT_KEY, 'accepted');
    const render = () =>
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(MarketingAnalyticsConsent, { enabled: true, language: 'ar' })),
      );
    await act(async () => render());
    route.pathname = '/ar/guides';
    await act(async () => render());
    await act(async () => render());
    const events = () => (window.dataLayer ?? []).filter((entry) => entry instanceof Object && 'event_name' in entry);
    expect(events()).toHaveLength(2);
    window.localStorage.setItem(MARKETING_ANALYTICS_CONSENT_KEY, 'declined');
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: MARKETING_ANALYTICS_CONSENT_KEY })));
    route.pathname = '/ar';
    await act(async () => render());
    sendMarketingAnalyticsEvent('free_tool_cta_clicked', {
      product: 'nibleaf',
      tool_slug: 'rtl-documentation-readiness',
      destination: 'sample_project_signup',
      placement: 'result_bridge',
    });
    expect(events()).toHaveLength(2);
  });
});
