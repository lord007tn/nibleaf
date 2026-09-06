// @vitest-environment jsdom

import { useQueryClient } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
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

it('loads consent with a query provider only when navigation reaches a marketing route', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<RootMarketingAnalytics pathname="/sites/synthetic/guide" siteProjectId="synthetic" language="en" />);
    });
    expect(container.innerHTML).toBe('');
    expect(loadConsent).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<RootMarketingAnalytics pathname="/sites/synthetic/missing" language="en" />);
    });
    expect(container.innerHTML).toBe('');
    expect(loadConsent).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<RootMarketingAnalytics pathname="/ar" language="ar" />);
      await vi.dynamicImportSettled();
    });
    expect(container.querySelector('[data-testid="consent"]')?.textContent).toBe('ar');
    expect(loadConsent).toHaveBeenCalledOnce();

    await act(async () => {
      root.render(<RootMarketingAnalytics pathname="/app" language="en" />);
    });
    expect(container.innerHTML).toBe('');
  } finally {
    await act(async () => root.unmount());
  }
});
