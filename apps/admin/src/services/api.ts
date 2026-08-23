import { hcWithType } from '@nibleaf/server/rpc';
import { APP_URL } from '@/lib/links';

// Admin authentication and API calls use the app origin. Better Auth's native
// impersonation cookie is therefore first-party when the operator enters /app.
const API_URL = APP_URL;

const client = hcWithType(API_URL, { init: { credentials: 'include' } });

/** Typed Hono RPC client for the Nibleaf API (rooted at `/api`). Sends the session cookie. */
export const api = client.api;

export type { InferRequestType, InferResponseType } from '@nibleaf/server/rpc';
export { API_URL };
