const env = import.meta.env;
const dev = env.DEV;

export const APP_URL = (env.VITE_APP_URL as string | undefined) ?? (dev ? 'http://localhost:4310' : 'https://app.trynibleaf.com');
export const WWW_URL = (env.VITE_WWW_URL as string | undefined) ?? (dev ? 'http://localhost:4313' : 'https://trynibleaf.com');
export const GITHUB_URL = (env.VITE_GITHUB_URL as string | undefined) ?? 'https://github.com/nibleaf-docs/nibleaf';

export { siteHref } from './site-paths';
