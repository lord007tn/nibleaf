import { getLocale, REQUEST_LOCALE_HEADER } from '@nibleaf/i18n';
import { hcWithType } from '@nibleaf/server/rpc';
import { env } from '@/env';

// Same-origin: requests go to the dashboard origin and are proxied to the API
// (see vite.config nitro routeRules), keeping the session cookie first-party.
const API_URL = typeof window === 'undefined' ? env.VITE_APP_URL : window.location.origin;

// The server mounts every module under `/api`, so the RPC client exposes an
// `.api` node. We pre-select it here so call sites read `api.app.projects` /
// `api.public.sites` (one `api`) instead of the doubled form.
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
