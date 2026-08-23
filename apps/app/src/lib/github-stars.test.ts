import { afterEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());

vi.mock('got', () => ({ default: request }));

afterEach(() => {
  request.mockReset();
  vi.resetModules();
});

describe('getGithubStars', () => {
  it('returns immediately on a cold render and caches the background response', async () => {
    let finishRequest: ((response: { body: unknown; ok: boolean }) => void) | undefined;
    const response = new Promise<{ body: unknown; ok: boolean }>((resolve) => {
      finishRequest = resolve;
    });
    request.mockReturnValue(response);
    const { getGithubStars } = await import('@/functions/marketing');

    await expect(getGithubStars()).resolves.toBe(0);
    expect(request).toHaveBeenCalledTimes(1);

    finishRequest?.({ body: { stargazers_count: 12 }, ok: true });
    await vi.waitFor(async () => {
      await expect(getGithubStars()).resolves.toBe(12);
    });
    await expect(getGithubStars()).resolves.toBe(12);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
