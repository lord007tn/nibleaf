// @vitest-environment jsdom

import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { RootMarketingAnalytics } from './root-marketing-analytics';

const { loadConsent } = vi.hoisted(() => ({ loadConsent: vi.fn() }));

vi.mock('./marketing-analytics-consent', () => {
  loadConsent();
  return {
    MarketingAnalyticsConsent: ({ language }: { language: string }) => {
      useQueryClient();
      return <div data-testid="consent">{language}</div>;
    },
  };
});

// The query client comes from the router for every route; the consent UI just uses it.
it('loads consent only when navigation reaches a marketing route', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  const client = createQueryClient();
  const render = (element: React.ReactElement) => root.render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  try {
    await act(async () => {
      render(<RootMarketingAnalytics pathname="/sites/synthetic/guide" siteProjectId="synthetic" language="en" />);
    });
    expect(container.innerHTML).toBe('');
    expect(loadConsent).not.toHaveBeenCalled();

    await act(async () => {
      render(<RootMarketingAnalytics pathname="/sites/synthetic/missing" language="en" />);
    });
    expect(container.innerHTML).toBe('');
    expect(loadConsent).not.toHaveBeenCalled();

    await act(async () => {
      render(<RootMarketingAnalytics pathname="/ar" language="ar" />);
      await vi.dynamicImportSettled();
    });
    expect(container.querySelector('[data-testid="consent"]')?.textContent).toBe('ar');
    expect(loadConsent).toHaveBeenCalledOnce();

    await act(async () => {
      render(<RootMarketingAnalytics pathname="/app" language="en" />);
    });
    expect(container.innerHTML).toBe('');
  } finally {
    await act(async () => root.unmount());
  }
});
