import { organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Same-origin: auth requests hit the dashboard origin and are proxied to the API
// (vite.config nitro routeRules), so the session cookie is first-party.
const API_URL = typeof window === 'undefined' ? 'http://localhost:4310' : window.location.origin;

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: '/api/auth',
  plugins: [organizationClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;

