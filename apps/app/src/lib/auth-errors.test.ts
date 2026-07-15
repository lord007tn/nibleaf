import { describe, expect, it } from 'vitest';
import { isEmailNotVerifiedError } from './auth-errors';

describe('isEmailNotVerifiedError', () => {
  it('recognizes the stable Better Auth error code', () => {
    expect(isEmailNotVerifiedError({ code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' })).toBe(true);
  });

  it('falls back to the human-readable message', () => {
    expect(isEmailNotVerifiedError({ message: 'Email not verified' })).toBe(true);
  });

  it('does not swallow unrelated sign-in errors', () => {
    expect(isEmailNotVerifiedError({ code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe(false);
  });
});
