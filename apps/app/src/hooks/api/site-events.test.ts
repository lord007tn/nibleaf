// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/services/api', () => ({ api: { public: { sites: { ':id': { events: { $post: post } } } } } }));

import { sendSiteAnalyticsEvent } from './site-events';

const event = {
  eventId: 'evt_1',
  occurredAt: '2026-11-26T10:00:00.000Z',
  consentState: 'granted' as const,
  payload: { name: 'page_view' as const, path: 'guides/start' },
};

afterEach(() => {
  post.mockReset();
  vi.restoreAllMocks();
});

it('posts the event once, with keepalive so it survives leaving the page', async () => {
  post.mockResolvedValue(new Response(null, { status: 204 }));
  await sendSiteAnalyticsEvent('site_1', event);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith({ param: { id: 'site_1' }, json: event }, { init: { keepalive: true } });
});

it('drops a failed send without retrying or throwing', async () => {
  post.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(sendSiteAnalyticsEvent('site_1', event)).resolves.toBeUndefined();
  post.mockResolvedValue(new Response(null, { status: 500 }));
  await expect(sendSiteAnalyticsEvent('site_1', event)).resolves.toBeUndefined();
  expect(post).toHaveBeenCalledTimes(2);
});

it('holds an event recorded offline until the reader is back online', async () => {
  post.mockResolvedValue(new Response(null, { status: 204 }));
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const sent = sendSiteAnalyticsEvent('site_1', event);
  await Promise.resolve();
  expect(post).not.toHaveBeenCalled();
  onLine.mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  await sent;
  expect(post).toHaveBeenCalledTimes(1);
});
