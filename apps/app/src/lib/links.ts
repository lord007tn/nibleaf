import { env } from '@/env';

export const APP_URL = env.VITE_APP_URL;
export const ADMIN_URL = env.VITE_ADMIN_URL;
export const GITHUB_URL = env.VITE_GITHUB_URL;
// Star counts are fetched live (with an in-memory cache) via getGithubStars()
// in lib/marketing-seo.ts — no hardcoded constant.

export { siteHref } from './site-paths';
