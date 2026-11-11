import { createSerializationAdapter } from '@tanstack/react-router';
import { ApiResponseError } from '@/hooks/api/client-helpers';

/**
 * Carries an `ApiResponseError` from the server to the browser intact.
 *
 * Server functions and SSR loaders call the API and throw `ApiResponseError` on
 * a failed answer. Without this adapter the error crossed the wire as a plain
 * `Error` (only its message survived), so the browser couldn't tell a refusal
 * from an outage: the query client retried 403s and 404s like network errors,
 * and the reader's client-side not-found check (`status === 404`) never matched.
 *
 * Only the fields the API already sends to clients are carried; `details` is
 * the server's JSON error details, so it travels as JSON text.
 */
export const apiResponseErrorAdapter = createSerializationAdapter({
  key: 'nibleaf-api-response-error',
  test: (value): value is ApiResponseError => value instanceof ApiResponseError,
  toSerializable: (error) => ({
    message: error.message,
    status: error.status,
    code: error.code ?? null,
    retryAfter: error.retryAfter ?? null,
    path: error.path ?? null,
    sourceFile: error.sourceFile ?? null,
    limit: error.limit ?? null,
    details: error.details ? JSON.stringify(error.details) : null,
  }),
  fromSerializable: (value) => {
    let details: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = value.details ? JSON.parse(value.details) : undefined;
      details = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      details = undefined;
    }
    return new ApiResponseError(
      value.message,
      value.status,
      value.code ?? undefined,
      value.retryAfter ?? undefined,
      value.path ?? undefined,
      value.sourceFile ?? undefined,
      value.limit ?? undefined,
      details,
    );
  },
});
