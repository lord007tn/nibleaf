import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('octokit', () => ({
  Octokit: class {
    rest = { repos: { get: state.get } };
  },
}));
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({ handler: (handler: unknown) => handler }) }));

describe('background GitHub star cache', () => {
  beforeEach(() => {
    vi.resetModules();
    state.get.mockReset();
  });

  it('loads the SDK lazily, deduplicates concurrent reads, and returns the cached result', async () => {
    state.get.mockResolvedValue({ data: { stargazers_count: 42 } });
    const { getGithubStars } = await import('./marketing');
    expect(state.get).not.toHaveBeenCalled();
    expect(await Promise.all([getGithubStars(), getGithubStars(), getGithubStars()])).toEqual([0, 0, 0]);
    await vi.dynamicImportSettled();
    await vi.waitFor(async () => expect(await getGithubStars()).toBe(42));
    expect(state.get).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed background read cached instead of failing a page loader or retrying immediately', async () => {
    state.get.mockRejectedValue(new Error('Unavailable'));
    const { getGithubStars } = await import('./marketing');
    expect(await getGithubStars()).toBe(0);
    await vi.dynamicImportSettled();
    await vi.waitFor(() => expect(state.get).toHaveBeenCalledTimes(1));
    expect(await getGithubStars()).toBe(0);
    expect(state.get).toHaveBeenCalledTimes(1);
  });
});
