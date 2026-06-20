import { hcWithType } from '@plume/server/rpc';

// Same-origin: requests go to the dashboard origin and are proxied to the API
// (see vite.config nitro routeRules), keeping the session cookie first-party.
const API_URL = typeof window === 'undefined' ? 'http://localhost:4310' : window.location.origin;

/** Typed Hono RPC client for the Plume API. Sends the session cookie. */
export const api = hcWithType(API_URL, { init: { credentials: 'include' } });

export { API_URL };
