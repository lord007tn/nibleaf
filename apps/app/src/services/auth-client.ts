import { createNibleafAuthClientFn } from '@nibleaf/auth/client';
import { getLocale } from '@nibleaf/i18n';

// Same-origin: auth requests hit the dashboard origin and are proxied to the API
// (vite.config nitro routeRules), so the session cookie is first-party.
const API_URL = typeof window === 'undefined' ? 'http://localhost:4310' : window.location.origin;

export const authClient = createNibleafAuthClientFn({ baseURL: API_URL, locale: getLocale });

export const { signIn, useSession } = authClient;
