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
  await expect(getGitHubDefaultBranch('synthetic', 'docs')).rejects.toMatchObject({
    status: 400,
    message: 'GitHub rate limit reached. Try again in about 60 minutes.',
  });
  expect(request).toHaveBeenCalledOnce();
}, 2000);
it.each([
  ['a secondary limit', 429, { 'retry-after': '90' }, 'GitHub rate limit reached. Try again in about 2 minutes.'],
  [
    'retry-after over a passed reset',
    429,
    { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1', 'retry-after': '3600' },
    'GitHub rate limit reached. Try again in about 60 minutes.',
  ],
  ['a reset that has passed', 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' }, 'GitHub API error (403). Try again shortly.'],
  ['an unusable reset', 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'Infinity' }, 'GitHub API error (403). Try again shortly.'],
  ['an absurd retry-after', 429, { 'retry-after': '1e300' }, 'GitHub API error (429). Try again shortly.'],
  ['a server error with retry-after', 503, { 'retry-after': '90' }, 'GitHub API error (503). Try again shortly.'],
])('explains %s', async (_name, status, headers, message) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ message: 'failed' }), { status, headers: { 'content-type': 'application/json', ...headers } })),
  );
  await expect(getGitHubDefaultBranch('synthetic', 'docs')).rejects.toMatchObject({ status: 400, message });
});
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
