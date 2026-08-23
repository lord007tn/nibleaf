import { getLocale, REQUEST_LOCALE_HEADER } from '@nibleaf/i18n';
import { hcWithType } from '@nibleaf/server/rpc';
import { APP_URL } from '@/lib/links';

// Admin authentication and API calls use the app origin. Better Auth's native
// impersonation cookie is therefore first-party when the operator enters /app.
const API_URL = APP_URL;

const client = hcWithType(API_URL, {
  init: { credentials: 'include' },
  fetch: (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set(REQUEST_LOCALE_HEADER, getLocale());
    return fetch(input, { ...init, headers });
  },
});

/** Typed Hono RPC client for the Nibleaf API (rooted at `/api`). Sends the session cookie. */
export const api = client.api;

export type { InferResponseType } from '@nibleaf/server/rpc';
