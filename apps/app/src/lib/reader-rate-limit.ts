import type { defaultStreamHandler } from '@tanstack/react-start/server';
import { ApiResponseError } from '@/hooks/api/client-helpers';

type RenderResult = Response | Awaited<ReturnType<typeof defaultStreamHandler>>;

/** Router renders loader errors as 500; retain a known upstream throttle status. */
export const readerRateLimitResponse = (result: RenderResult, errors: readonly unknown[]): RenderResult => {
  const error = errors.find((item): item is ApiResponseError => item instanceof ApiResponseError && item.status === 429);
  const response = result instanceof Response ? result : result.response;
  if (!error || response.status !== 500) return result;
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  if (error.retryAfter) headers.set('retry-after', error.retryAfter);
  const corrected = new Response(response.body, { status: 429, statusText: 'Too Many Requests', headers });
  return result instanceof Response ? corrected : { ...result, response: corrected };
};
