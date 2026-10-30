// @vitest-environment jsdom
import type { ProjectConfig } from '@nibleaf/validators';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createEvent: vi.fn() }));
vi.mock('@/hooks/api/site-events', () => ({ useCreateSiteAnalyticsEvent: () => ({ mutate: mocks.createEvent }) }));

import { SiteAnalyticsProvider, useSiteAnalytics } from './site-analytics-provider';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

function ReaderContent() {
  const { track } = useSiteAnalytics();
  return (
    <>
      <p>Documentation remains readable.</p>
      <button type="button" onClick={() => track({ name: 'feedback_submitted', path: 'start', feedback: 'helpful', target: 'page' })}>
        Helpful
      </button>
    </>
  );
}

beforeEach(() => {
  mocks.createEvent.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

async function render(config?: ProjectConfig) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      <SiteAnalyticsProvider projectId="docs" path="start" language="en" config={config}>
        <ReaderContent />
      </SiteAnalyticsProvider>,
    ),
  );
  return container;
}

it('renders documentation and handles reader actions when all browser storage is denied', async () => {
  for (const storage of ['localStorage', 'sessionStorage'] as const) {
    vi.spyOn(window, storage, 'get').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
  }
  const container = await render({ analytics: { cookieConsent: true } });
  expect(container.textContent).toContain('Documentation remains readable.');
  expect(mocks.createEvent).toHaveBeenCalledWith(
    expect.objectContaining({ consentState: 'unknown', sessionId: undefined, payload: expect.objectContaining({ name: 'page_view' }) }),
  );
  await act(async () => container.querySelector('button')?.click());
  expect(mocks.createEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({ consentState: 'unknown', sessionId: undefined, payload: expect.objectContaining({ name: 'feedback_submitted' }) }),
  );
});

it('keeps the session ID stable and reports an existing consent choice when storage works', async () => {
  window.localStorage.setItem('nibleaf.analytics.consent.docs', 'accepted');
  const container = await render({ analytics: { cookieConsent: true } });
  const pageView = mocks.createEvent.mock.calls[0]?.[0];
  expect(pageView.consentState).toBe('granted');
  expect(pageView.sessionId).toBeTruthy();
  await act(async () => container.querySelector('button')?.click());
  expect(mocks.createEvent.mock.lastCall?.[0].sessionId).toBe(pageView.sessionId);
});

it('omits a new session ID when session storage cannot write', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage is full', 'QuotaExceededError');
  });
  await render();
  expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({ consentState: 'not_required', sessionId: undefined }));
});

it('omits document referrer on client views, including provider remounts', async () => {
  // A fresh document has not yet emitted a page view.
  const fresh = document.implementation.createHTMLDocument();
  Object.defineProperty(fresh, 'referrer', { value: 'https://example.test/source' });
  vi.stubGlobal('document', fresh);
  try {
    await render();
    expect(mocks.createEvent.mock.lastCall?.[0].payload.referrer).toBe('https://example.test/source');
    await act(async () =>
      roots[0]?.render(
        <SiteAnalyticsProvider projectId="docs" path="next">
          <ReaderContent />
        </SiteAnalyticsProvider>,
      ),
    );
    expect(mocks.createEvent.mock.lastCall?.[0].payload.referrer).toBeUndefined();
    await render();
    expect(mocks.createEvent.mock.lastCall?.[0].payload.referrer).toBeUndefined();
    for (const root of roots.splice(0)) await act(async () => root.unmount());
  } finally {
    vi.unstubAllGlobals();
  }
});

it('reports the old page maximum scroll depth without reading replacement geometry at cleanup', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2000);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
  const scroll = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0);
  await render();
  scroll.mockReturnValue(750);
  window.dispatchEvent(new Event('scroll'));
  scroll.mockReturnValue(250);
  window.dispatchEvent(new Event('scroll'));
  now = 1500;
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(1000);
  scroll.mockReturnValue(0);
  await act(async () =>
    roots[0]?.render(
      <SiteAnalyticsProvider projectId="docs" path="next">
        <ReaderContent />
      </SiteAnalyticsProvider>,
    ),
  );
  const engagement = mocks.createEvent.mock.calls.map(([event]) => event.payload).find((payload) => payload.name === 'page_engaged');
  expect(engagement).toMatchObject({ path: 'start', engagementMs: 1500, scrollDepth: 75 });
  now = 2000;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(mocks.createEvent.mock.calls.filter(([event]) => event.payload.name === 'page_engaged')).toHaveLength(1);
  now = 3000;
  document.dispatchEvent(new Event('visibilitychange'));
  expect(mocks.createEvent.mock.lastCall?.[0].payload).toMatchObject({ name: 'page_engaged', path: 'next', scrollDepth: 0 });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(mocks.createEvent.mock.calls.filter(([event]) => event.payload.name === 'page_engaged')).toHaveLength(2);
  Reflect.deleteProperty(document, 'visibilityState');
});


it('keeps the page view and engagement timer when equivalent shell config is refreshed', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const config: ProjectConfig = { analytics: { cookieConsent: false } };
  await render(config);
  now = 1500;
  await act(async () => roots[0]?.render(
    <SiteAnalyticsProvider projectId="docs" path="start" language="en" config={structuredClone(config)}>
      <ReaderContent />
    </SiteAnalyticsProvider>,
  ));
  expect(mocks.createEvent.mock.calls.filter(([event]) => event.payload.name === 'page_view')).toHaveLength(1);
  expect(mocks.createEvent.mock.calls.filter(([event]) => event.payload.name === 'page_engaged')).toHaveLength(0);
  now = 2300;
  await act(async () => roots[0]?.unmount());
  roots.splice(0);
  expect(mocks.createEvent.mock.lastCall?.[0].payload).toMatchObject({ name: 'page_engaged', engagementMs: 2300 });
});

it('uses the latest consent config without restarting the page lifecycle', async () => {
  const container = await render({ analytics: { cookieConsent: false } });
  await act(async () => roots[0]?.render(
    <SiteAnalyticsProvider projectId="docs" path="start" language="en" config={{ addons: { consentBanner: { enabled: false } } }}>
      <ReaderContent />
    </SiteAnalyticsProvider>,
  ));
  await act(async () => container.querySelector('button')?.click());
  expect(mocks.createEvent.mock.lastCall?.[0].consentState).toBe('denied');
  expect(mocks.createEvent.mock.calls.filter(([event]) => event.payload.name === 'page_view')).toHaveLength(1);
});
