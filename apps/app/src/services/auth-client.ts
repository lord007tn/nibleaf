import { createNibleafAuthClientFn } from '@nibleaf/auth/client';

// Same-origin: auth requests hit the dashboard origin and are proxied to the API
// (vite.config nitro routeRules), so the session cookie is first-party.
const API_URL = typeof window === 'undefined' ? 'http://localhost:4310' : window.location.origin;

export const authClient = createNibleafAuthClientFn({ baseURL: API_URL });

export const { signIn, signUp, signOut, useSession } = authClient;
