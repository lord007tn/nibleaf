// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createChatEventQueue } from './events';

const event = { name: 'new_chat', conversationId: '00000000-0000-4000-8000-000000000001' } as const;
afterEach(() => vi.useRealTimers());
it('batches twenty events and flushes the remainder after one second', async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockResolvedValue(undefined);
  const q = createChatEventQueue(send);
  for (let i = 0; i < 21; i++) q.track(event, { consent: 'unknown' });
  await vi.advanceTimersByTimeAsync(1000);
  expect(send.mock.calls.map((c) => c[0].events.length)).toEqual([20, 1]);
});
it('keeps consent changes separate and drops failed sends', async () => {
  const send = vi.fn().mockRejectedValue(new Error('offline'));
  const q = createChatEventQueue(send);
  q.track(event, { consent: 'granted', sessionId: 'session1' });
  q.track(event, { consent: 'denied' });
  q.flush();
  await Promise.resolve();
  expect(send.mock.calls.map((c) => c[0].consent)).toEqual(['granted', 'denied']);
});
it('flushes on pagehide and removes lifecycle listeners', async () => {
  const send = vi.fn();
  const q = createChatEventQueue(send);
  q.track(event, { consent: 'unknown' });
  window.dispatchEvent(new Event('pagehide'));
  await Promise.resolve();
  expect(send).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('pagehide'));
  expect(send).toHaveBeenCalledOnce();
});

it('flushes when the page becomes hidden', async () => {
  const send = vi.fn();
  const q = createChatEventQueue(send);
  q.track(event, { consent: 'unknown' });
  const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  expect(send).toHaveBeenCalledOnce();
  state.mockRestore();
});

it('starts an unload send synchronously and does not duplicate it for hidden plus pagehide', () => {
  const send = vi.fn(async (_body: { consent: string }) => undefined);
  const q = createChatEventQueue(send);
  q.track(event, { consent: 'denied' });
  const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(send).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('pagehide'));
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[0]).toMatchObject({ consent: 'denied' });
  state.mockRestore();
});
