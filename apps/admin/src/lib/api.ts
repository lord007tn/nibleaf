import { hcWithType } from '@nibleaf/server/rpc';

// Same-origin: requests go to the admin origin and are proxied to the API
// (see vite.config nitro routeRules), keeping the session cookie first-party.
const API_URL = typeof window === 'undefined' ? 'http://localhost:4315' : window.location.origin;

const client = hcWithType(API_URL, { init: { credentials: 'include' } });

/** Typed Hono RPC client for the Nibleaf API (rooted at `/api`). Sends the session cookie. */
export const api = client.api;

export type { InferRequestType, InferResponseType } from '@nibleaf/server/rpc';
export { API_URL };
