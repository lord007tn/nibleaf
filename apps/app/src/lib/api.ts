import { hcWithType } from '@midad/server/rpc';

// Same-origin: requests go to the dashboard origin and are proxied to the API
// (see vite.config nitro routeRules), keeping the session cookie first-party.
const API_URL = typeof window === 'undefined' ? 'http://localhost:4310' : window.location.origin;

// The server mounts every module under `/api`, so the RPC client exposes an
// `.api` node. We pre-select it here so call sites read `api.app.projects` /
// `api.public.sites` (one `api`) instead of the doubled form.
const client = hcWithType(API_URL, { init: { credentials: 'include' } });

/** Typed Hono RPC client for the Midad API (rooted at `/api`). Sends the session cookie. */
export const api = client.api;

export { API_URL };


