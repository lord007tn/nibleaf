import { createServerFn } from '@tanstack/react-start';
import got from 'got';
import { z } from 'zod';

const STARS_TTL_MS = 60 * 60 * 1000;
const STARS_ERROR_TTL_MS = 60 * 1000;
let starsCache: { fetchedAt: number; value: number } | null = null;
let inFlight: Promise<number> | null = null;

export const getGithubStars = async () => {
  const now = Date.now();
  if (starsCache) {
    const ttl = starsCache.value > 0 ? STARS_TTL_MS : STARS_ERROR_TTL_MS;
    if (now - starsCache.fetchedAt < ttl) return starsCache.value;
  }
  if (!inFlight) {
    inFlight = got('https://api.github.com/repos/Nibleaf/open-mintlify', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nibleaf' },
      responseType: 'json',
      retry: { limit: 1 },
      throwHttpErrors: false,
      timeout: { request: 2000 },
    })
      .then((response) => {
        const parsed = z.object({ stargazers_count: z.number().int().nonnegative() }).safeParse(response.body);
        const value = response.ok && parsed.success ? parsed.data.stargazers_count : (starsCache?.value ?? 0);
        starsCache = { value, fetchedAt: Date.now() };
        return value;
      })
      .catch(() => {
        const value = starsCache?.value ?? 0;
        starsCache = { value, fetchedAt: Date.now() };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return starsCache?.value ?? 0;
};

export const getGithubStarsFn = createServerFn({ method: 'GET' }).handler(getGithubStars);
