const env = import.meta.env;
const dev = env.DEV;

export const APP_URL = (env.VITE_APP_URL as string | undefined) ?? (dev ? 'http://localhost:4310' : 'https://app.plume.dev');
export const WWW_URL = (env.VITE_WWW_URL as string | undefined) ?? (dev ? 'http://localhost:4313' : 'https://plume.dev');
export const GITHUB_URL = (env.VITE_GITHUB_URL as string | undefined) ?? 'https://github.com/plume-docs/plume';

/** Public URL for a published documentation site (in-app live preview route). */
export const siteHref = (projectId: string, path = ''): string => `/sites/${projectId}${path ? `/${path.replace(/^\/+/, '')}` : ''}`;
