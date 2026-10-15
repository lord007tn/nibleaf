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

beforeEach(() => mocks.createEvent.mockReset());
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
