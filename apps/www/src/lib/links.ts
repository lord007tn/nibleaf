const env = import.meta.env;
const dev = env.DEV;

export const APP_URL = (env.VITE_APP_URL as string | undefined) ?? (dev ? 'http://localhost:4310' : 'https://app.trymidad.com');
export const WWW_URL = (env.VITE_WWW_URL as string | undefined) ?? (dev ? 'http://localhost:4313' : 'https://trymidad.com');
export const GITHUB_URL = (env.VITE_GITHUB_URL as string | undefined) ?? 'https://github.com/lord007tn/midad';

export const appHref = (path = '/app') => new URL(path, APP_URL).toString();
export const canonicalHref = (path: string) => new URL(path, WWW_URL).toString();
