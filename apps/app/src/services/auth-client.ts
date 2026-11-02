import { createNibleafAuthClientFn } from '@nibleaf/auth/client';
import { getLocale } from '@nibleaf/i18n/runtime';
import { apiOrigin } from './api-origin';

// Same-origin: auth requests hit the dashboard origin and are proxied to the API
// (vite.config nitro routeRules), so the session cookie is first-party.
const API_URL = apiOrigin();

export const authClient = createNibleafAuthClientFn({ baseURL: API_URL, locale: getLocale });

export const { signIn, useSession } = authClient;
