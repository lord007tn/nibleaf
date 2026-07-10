const env = import.meta.env;
const dev = env.DEV;

export const APP_URL = (env.VITE_APP_URL as string | undefined) ?? (dev ? 'http://localhost:4310' : 'https://nibleaf.com');
export const GITHUB_URL = (env.VITE_GITHUB_URL as string | undefined) ?? 'https://github.com/lord007tn/nibleaf';
// Star counts are fetched live (with an in-memory cache) via getGithubStars()
// in lib/marketing-seo.ts — no hardcoded constant.

export { siteHref } from './site-paths';
