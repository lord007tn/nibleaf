import { expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({ handler: (handler: unknown) => handler }) }));

import { getGithubStars } from './marketing';

it('keeps loader stars fixed across requests without network or clock dependency', async () => {
  expect(await getGithubStars()).toBe(0);
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2030-01-01'));
    expect(await getGithubStars()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
