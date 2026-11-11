import { ApiResponseError } from '@/hooks/api/client-helpers';

/**
 * A page-data request that failed before the app server answered with a
 * structured API error: the network dropped it (status 0), or a gateway in
 * front of the app (the edge, a load balancer) answered with a bare status.
 * It extends ApiResponseError so the query client's retry policy (never 4xx)
 * applies unchanged.
 */
export class PageTransportError extends ApiResponseError {
  constructor(status: number, retryAfter?: string, cause?: unknown) {
    super(status === 0 ? 'The page could not be reached.' : `The page request failed (${status}).`, status, undefined, retryAfter);
    this.name = 'PageTransportError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Statuses a fresh document load can plausibly get past: the gateway or the app was briefly unavailable. */
const RECOVERABLE_STATUSES = new Set([502, 503, 504]);
/** Past this, a server asking us to wait is honoured by showing the error page instead. */
export const MAX_RECOVERY_WAIT_MS = 10_000;

/** `Retry-After` as milliseconds (seconds or an HTTP date), or null when absent or unreadable. */
export const retryAfterMs = (value: string | undefined, now = Date.now()): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
};

/**
 * How long to wait before loading the destination as a document, or null when
 * a document load wouldn't help: a 4xx (400, 401, 403, 404, 429 and the rest:
 * the server answered and meant it), a 500, anything unrecognised, or a
 * Retry-After longer than MAX_RECOVERY_WAIT_MS.
 */
export function navigationRecoveryDelay(error: unknown, now = Date.now()): number | null {
  if (!(error instanceof ApiResponseError)) return null;
  const network = error instanceof PageTransportError && error.status === 0;
  if (!network && !RECOVERABLE_STATUSES.has(error.status)) return null;
  const wait = retryAfterMs(error.retryAfter, now);
  if (wait === null) return 0;
  return wait <= MAX_RECOVERY_WAIT_MS ? wait : null;
}
