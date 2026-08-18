import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('getGithubStars', () => {
  it('never blocks a cold render on GitHub and caches the eventual authoritative response', async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      finishRequest = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response),
    );
    const { getGithubStars } = await import('@/lib/marketing-seo');

    expect(getGithubStars()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    finishRequest?.(new Response(JSON.stringify({ stargazers_count: 12 }), { status: 200 }));
    await vi.waitFor(() => expect(getGithubStars()).toBe(12));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
