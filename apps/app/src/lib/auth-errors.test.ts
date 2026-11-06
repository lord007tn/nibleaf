import { describe, expect, it } from 'vitest';
import { friendlyAuthError, isAccountSuspendedError, isEmailNotVerifiedError } from './auth-errors';

const t = (key: string) => `t:${key}`;

describe('friendlyAuthError', () => {
  it('tells a suspended or banned account to contact support instead of blaming the code', () => {
    const suspended = { status: 403, message: 'This account has been suspended. Contact support@nibleaf.com if you believe this is a mistake.' };
    expect(friendlyAuthError(suspended, t, 'Invalid code')).toBe('t:auth.error.suspended');
    expect(friendlyAuthError({ status: 403, code: 'BANNED_USER', message: 'You have been banned from this application' }, t, 'Invalid code')).toBe(
      't:auth.error.suspended',
    );
    expect(isAccountSuspendedError({ status: 403, code: 'INVALID_ORIGIN', message: 'Invalid origin' })).toBe(false);
  });

  it('localizes rate limits and server failures, and never shows the English server text', () => {
    expect(friendlyAuthError({ status: 429, message: 'Too many requests' }, t, 'Fallback')).toBe('t:auth.otp.tooManyAttempts');
    expect(friendlyAuthError({ code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts' }, t, 'Fallback')).toBe('t:auth.otp.tooManyAttempts');
    expect(friendlyAuthError({ status: 500, message: 'Internal Server Error' }, t, 'Fallback')).toBe('t:auth.error.tryAgain');
    expect(friendlyAuthError({ status: 503, code: 'AUTH_EMAIL_UNAVAILABLE', message: 'Unable to send a code.' }, t, 'Could not send')).toBe(
      'Could not send',
    );
  });

  it("keeps the operation's own message for everything else", () => {
    expect(friendlyAuthError({ status: 400, code: 'INVALID_OTP', message: 'Invalid OTP' }, t, 'That code is invalid')).toBe('That code is invalid');
    expect(friendlyAuthError(undefined, t, 'Fallback')).toBe('Fallback');
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
