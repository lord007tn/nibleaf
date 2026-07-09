const env = import.meta.env;
const dev = env.DEV;

export const APP_URL = (env.VITE_APP_URL as string | undefined) ?? (dev ? 'http://localhost:4310' : 'https://nibleaf.com');
export const WWW_URL = (env.VITE_WWW_URL as string | undefined) ?? (dev ? 'http://localhost:4313' : 'https://nibleaf.com');
export const GITHUB_URL = (env.VITE_GITHUB_URL as string | undefined) ?? 'https://github.com/lord007tn/nibleaf';
export const GITHUB_STARS = 0;

export { siteHref } from './site-paths';
