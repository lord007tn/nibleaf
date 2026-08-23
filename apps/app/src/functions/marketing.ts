import { createServerFn } from '@tanstack/react-start';
import { Octokit } from 'octokit';

const STARS_TTL_MS = 60 * 60 * 1000;
const STARS_ERROR_TTL_MS = 60 * 1000;
let starsCache: { fetchedAt: number; value: number } | null = null;
let inFlight: Promise<number> | null = null;
const github = new Octokit({ request: { timeout: 2000 }, userAgent: 'nibleaf-marketing' });

export const getGithubStars = async () => {
  const now = Date.now();
  if (starsCache) {
    const ttl = starsCache.value > 0 ? STARS_TTL_MS : STARS_ERROR_TTL_MS;
    if (now - starsCache.fetchedAt < ttl) return starsCache.value;
  }
  if (!inFlight) {
    inFlight = github.rest.repos
      .get({ owner: 'Nibleaf', repo: 'open-mintlify' })
      .then((response) => {
        const value = response.data.stargazers_count;
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
