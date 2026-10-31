import { afterEach, expect, it, vi } from 'vitest';
import { getGitHubDefaultBranch, listGitHubFiles } from './github';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('returns quota exhaustion promptly instead of waiting for the reset', async () => {
  const request = vi.fn(
    async () =>
      new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 403,
        headers: {
          'content-type': 'application/json',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
          'retry-after': '3600',
        },
      }),
  );
  vi.stubGlobal('fetch', request);
  await expect(getGitHubDefaultBranch('synthetic', 'docs')).rejects.toMatchObject({ status: 400 });
  expect(request).toHaveBeenCalledOnce();
}, 2000);
it('creates a fresh thirty-second signal for each API call', async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options: RequestInit) => {
      signals.push(options.signal as AbortSignal);
      expect(options.signal?.aborted).toBe(false);
      return Response.json({ tree: [], default_branch: 'main' });
    }),
  );
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  await getGitHubDefaultBranch('synthetic', 'docs');
  await listGitHubFiles('synthetic', 'docs', 'main');
  expect(signals).toHaveLength(2);
  expect(signals[0]).not.toBe(signals[1]);
  expect(timeout.mock.calls).toEqual([[30_000], [30_000]]);
  timeout.mockRestore();
});
