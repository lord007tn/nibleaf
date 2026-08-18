import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('getGithubStars', () => {
  it('waits for and caches the authoritative response on a cold render', async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      finishRequest = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response),
    );
    const { getGithubStars } = await import('@/lib/marketing-seo');

    const firstCount = getGithubStars();
    expect(fetch).toHaveBeenCalledTimes(1);

    finishRequest?.(new Response(JSON.stringify({ stargazers_count: 12 }), { status: 200 }));
    await expect(firstCount).resolves.toBe(12);
    await expect(getGithubStars()).resolves.toBe(12);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
