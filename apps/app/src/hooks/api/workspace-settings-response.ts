import { ApiResponseError, getData } from './client-helpers';
import type { WorkspaceSettings } from './types';

// Settings GET/PATCH guards, validation, and the error handler's HTTP/database codes.
const CODES = new Set([
  'auth:no_user',
  'auth:invalid_session',
  'auth:insufficient_role',
  'validation:failed',
  'http:bad_request',
  'http:unauthorized',
  'http:forbidden',
  'http:not_found',
  'http:conflict',
  'http:rate_limited',
  'http:internal',
  'database:not_found',
  'database:conflict',
]);

/** Reconstruct, never forward a server body, Error cause/stack, or echoed credentials into caches. */
export function safeSettingsError(error: unknown, fallback: string, codes = CODES) {
  if (error instanceof ApiResponseError) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    const code = error.code && codes.has(error.code) ? error.code : undefined;
    const retryAfter = error.retryAfter && /^\d{1,6}$/.test(error.retryAfter) ? error.retryAfter : undefined;
    return new ApiResponseError(fallback, status, code, retryAfter);
  }
  return error instanceof TypeError ? new TypeError(fallback) : new Error(fallback);
}

/** Project before query/mutation retention, including answers from an older server. Not a query `select`. */
export async function readWorkspaceSettings(response: Promise<Response>, fallback: string): Promise<WorkspaceSettings> {
  try {
    const settings = await getData<WorkspaceSettings>(await response, 'settings', fallback);
    const wireGit: Record<string, unknown> = settings.git ?? {};
    const { webhookSecret, ...git } = wireGit;
    return {
      ...settings,
      git: { ...git, webhookConfigured: typeof git.webhookConfigured === 'boolean' ? git.webhookConfigured : Boolean(webhookSecret) },
    };
  } catch (error) {
    throw safeSettingsError(error, fallback);
  }
}
