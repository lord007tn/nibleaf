import { validator as baseValidator } from 'hono-openapi';
import { AppError } from '@/errors';

/**
 * hono-openapi's validator (via @hono/standard-validator) answers a malformed
 * body with a raw HTTP 400 `{ data, error, success: false }`, bypassing our
 * AppError envelope and the documented 422 shape. This drop-in wrapper adds a
 * hook that throws a `validation:failed` AppError instead, so every validation
 * failure flows through the global error handler as the documented
 * `{ error: { code, message, details } }` with status 422.
 */
// biome-ignore lint/suspicious/noExplicitAny: thin pass-through that preserves the overloaded validator signature
const withEnvelope = (target: any, schema: any) =>
  baseValidator(target, schema, (result: { success: boolean; error?: unknown }) => {
    if (!result.success) {
      throw new AppError({ code: 'validation:failed', message: 'Validation failed.', details: { issues: result.error } });
    }
  });

export const validator = withEnvelope as unknown as typeof baseValidator;
