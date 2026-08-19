import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('getGithubStars', () => {
  it('returns immediately on a cold render and caches the background response', async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      finishRequest = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response),
    );
    const { getGithubStars } = await import('@/lib/marketing-seo');

    await expect(getGithubStars()).resolves.toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    finishRequest?.(new Response(JSON.stringify({ stargazers_count: 12 }), { status: 200 }));
    await vi.waitFor(async () => {
      await expect(getGithubStars()).resolves.toBe(12);
    });
    await expect(getGithubStars()).resolves.toBe(12);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
