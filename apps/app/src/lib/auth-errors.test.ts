import { describe, expect, it } from 'vitest';
import { authEmailErrorMessage, isEmailNotVerifiedError } from './auth-errors';

describe('authEmailErrorMessage', () => {
  it('uses translated delivery feedback only for the stable unavailable code', () => {
    expect(authEmailErrorMessage({ code: 'AUTH_EMAIL_UNAVAILABLE', message: 'English backend message' }, 'Localized delivery error')).toBe(
      'Localized delivery error',
    );
  });

  it('preserves useful messages for unrelated errors', () => {
    expect(authEmailErrorMessage({ code: 'TOO_MANY_REQUESTS', message: 'Wait before retrying' }, 'Delivery error')).toBe('Wait before retrying');
    expect(authEmailErrorMessage({ message: 'AUTH_EMAIL_UNAVAILABLE is only message text' }, 'Delivery error')).toBe(
      'AUTH_EMAIL_UNAVAILABLE is only message text',
    );
  });

  it('preserves an operation-specific fallback when no message is available', () => {
    expect(authEmailErrorMessage({ code: 'INVALID_OTP' }, 'Delivery error', 'Verification error')).toBe('Verification error');
    expect(authEmailErrorMessage(undefined, 'Delivery error')).toBe('Delivery error');
  });
});

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
