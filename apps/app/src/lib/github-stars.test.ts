import { afterEach, describe, expect, it, vi } from 'vitest';

const getRepository = vi.hoisted(() => vi.fn());

vi.mock('octokit', () => ({
  Octokit: class {
    rest = { repos: { get: getRepository } };
  },
}));

afterEach(() => {
  getRepository.mockReset();
  vi.resetModules();
});

describe('getGithubStars', () => {
  it('returns immediately on a cold render and caches the background response', async () => {
    let finishRequest: ((response: { data: { stargazers_count: number } }) => void) | undefined;
    const response = new Promise<{ data: { stargazers_count: number } }>((resolve) => {
      finishRequest = resolve;
    });
    getRepository.mockReturnValue(response);
    const { getGithubStars } = await import('@/functions/marketing');

    await expect(getGithubStars()).resolves.toBe(0);
    expect(getRepository).toHaveBeenCalledTimes(1);
    expect(getRepository).toHaveBeenCalledWith({ owner: 'lord007tn', repo: 'nibleaf' });

    finishRequest?.({ data: { stargazers_count: 12 } });
    await vi.waitFor(async () => {
      await expect(getGithubStars()).resolves.toBe(12);
    });
    await expect(getGithubStars()).resolves.toBe(12);
    expect(getRepository).toHaveBeenCalledTimes(1);
  });
});
