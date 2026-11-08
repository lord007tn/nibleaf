import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('uses the same supplied build snapshot for every loader request', async () => {
  vi.stubGlobal('__MARKETING_BUILD__', { year: 2026, stars: 12 });
  const { getGithubStars } = await import('@/functions/marketing');
  expect(await getGithubStars()).toBe(12);
  expect(await getGithubStars()).toBe(12);
});
