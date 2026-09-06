// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { readFirstPublishAttribution, recordFirstPublishStage } from '@/lib/first-publish-activation';
import { persistMarketingAnalyticsConsent } from '@/lib/marketing-analytics';

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => ({ options, useLoaderData: () => ({ stars: 0 }) }) }));
vi.mock('@/components/cloud-marketing', () => ({
  MarketingShell: ({ children }: { children: React.ReactNode }) => children,
  Eyebrow: ({ children }: { children: React.ReactNode }) => children,
  outlineButton: '',
  primaryButton: '',
}));

import { Route } from './rtl-documentation-readiness';

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

it.each(['accepted', 'declined'] as const)(
  'carries a real grader result CTA into project/editor/manual-publish context only when %s',
  async (consent) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    persistMarketingAnalyticsConsent(consent);
    const request = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', request);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const Component = Route.options.component as React.ComponentType;
    try {
      await act(async () => root.render(<Component />));
      const analyze = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Analyze HTML');
      await act(async () => analyze?.click());
      const cta = container.querySelector<HTMLAnchorElement>('a[href*="intent=first-publish"]');
      expect(cta).not.toBeNull();
      cta?.addEventListener('click', (event) => event.preventDefault());
      await act(async () => cta?.click());
      const attribution = { entry_point: 'free_tool', intent: 'first_publish', source: 'rtl_readiness_grader' };
      expect(readFirstPublishAttribution()).toEqual(consent === 'accepted' ? attribution : null);
      expect(await recordFirstPublishStage('project_entered')).toBe(consent === 'accepted');
      expect(await recordFirstPublishStage('editor_entered')).toBe(consent === 'accepted');
      const payloads = request.mock.calls.map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
      expect(payloads).toContainEqual(expect.objectContaining({ event: 'free_tool_cta_clicked' }));
      if (consent === 'accepted') {
        expect(payloads).toContainEqual({ stage: 'project_entered', properties: attribution });
        expect(payloads).toContainEqual({ stage: 'editor_entered', properties: attribution });
        expect(payloads).toContainEqual({
          event: 'first_publish_cta_clicked',
          properties: { ...attribution, destination: 'signup', placement: 'result_bridge' },
        });
      }
      expect(JSON.stringify(payloads)).not.toMatch(/submitted_html|projectId|userId|docs\.example\.com/);
      persistMarketingAnalyticsConsent('declined');
      expect(readFirstPublishAttribution()).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
