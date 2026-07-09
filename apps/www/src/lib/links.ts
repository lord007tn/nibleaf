const env = import.meta.env;
const dev = env.DEV;

export const APP_URL = (env.VITE_APP_URL as string | undefined) ?? (dev ? 'http://localhost:4310' : 'https://nibleaf.com');
export const WWW_URL = (env.VITE_WWW_URL as string | undefined) ?? (dev ? 'http://localhost:4313' : 'https://nibleaf.com');
export const GITHUB_URL = (env.VITE_GITHUB_URL as string | undefined) ?? 'https://github.com/lord007tn/nibleaf';
// Widened to `number` (not the literal `0`) so `GITHUB_STARS > 0` guards that
// hide the star count until the repo has stars aren't flagged as constant.
export const GITHUB_STARS: number = 0;

export const appHref = (path = '/app') => new URL(path, APP_URL).toString();
export const canonicalHref = (path: string) => new URL(path, WWW_URL).toString();
