import { describe, expect, it } from 'vitest';
import {
  formatWait,
  friendlyAuthError,
  friendlyEmailChangeError,
  isAccountSuspendedError,
  isEmailNotVerifiedError,
  isSameEmail,
  otpFailure,
  rateLimitWait,
  retryAfterSeconds,
} from './auth-errors';

const t = (key: string) => `t:${key}`;

describe('friendlyAuthError', () => {
  it.each([
    ['TERMS_REQUIRED', 'auth.legal.termsRequired'],
    ['SIGNUP_CLOSED', 'auth.legal.signupClosed'],
  ])('localizes %s with recovery instructions', (code, key) => {
    expect(friendlyAuthError({ code }, t, 'Invalid code')).toBe(`t:${key}`);
  });
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
    // Better Auth deletes a code after its third wrong guess: waiting won't help, a new code will.
    expect(friendlyAuthError({ status: 403, code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts' }, t, 'Fallback')).toBe('t:auth.otp.codeLocked');
    // A server failure is on our side: it doesn't tell the person to check their connection.
    expect(friendlyAuthError({ status: 500, message: 'Internal Server Error' }, t, 'Fallback')).toBe('t:auth.error.serverError');
    expect(friendlyAuthError({ status: 503, code: 'AUTH_EMAIL_UNAVAILABLE', message: 'Unable to send a code.' }, t, 'Could not send')).toBe(
      'Could not send',
    );
  });

  it("keeps the operation's own message for everything else", () => {
    expect(friendlyAuthError({ status: 400, code: 'INVALID_OTP', message: 'Invalid OTP' }, t, 'That code is invalid')).toBe('That code is invalid');
    expect(friendlyAuthError(undefined, t, 'Fallback')).toBe('Fallback');
  });
});

describe('friendlyEmailChangeError', () => {
  const codeInvalid = 'That verification code is invalid or expired';

  it("doesn't blame the code when the new address itself is the problem", () => {
    expect(friendlyEmailChangeError({ status: 400, message: 'Email is the same' }, t, codeInvalid)).toBe('t:settings.account.email.sameAsCurrent');
    expect(friendlyEmailChangeError({ status: 400, code: 'INVALID_EMAIL', message: 'Invalid email' }, t, codeInvalid)).toBe(
      't:validation.emailInvalid',
    );
  });

  it('localizes "already in use" at the confirm step instead of showing the English server text', () => {
    expect(friendlyEmailChangeError({ status: 400, message: 'Email already in use' }, t, codeInvalid)).toBe('t:settings.account.email.inUse');
  });

  it('keeps the code message for code errors and the shared policy for the rest', () => {
    expect(friendlyEmailChangeError({ status: 400, code: 'INVALID_OTP', message: 'Invalid OTP' }, t, codeInvalid)).toBe(codeInvalid);
    expect(friendlyEmailChangeError({ status: 400, code: 'OTP_EXPIRED', message: 'OTP expired' }, t, codeInvalid)).toBe(codeInvalid);
    expect(friendlyEmailChangeError({ status: 429, message: 'Too many requests' }, t, codeInvalid)).toBe('t:auth.otp.tooManyAttempts');
    expect(friendlyEmailChangeError({ status: 502, message: 'Bad gateway' }, t, codeInvalid)).toBe('t:auth.error.serverError');
  });

  it('recognizes the current address however it is typed', () => {
    expect(isSameEmail('Writer@Example.com', '  writer@example.com ')).toBe(true);
    expect(isSameEmail('writer@example.com', 'new@example.com')).toBe(false);
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

describe('otpFailure', () => {
  const tv = (key: string, variables?: Record<string, string | number>) => `t:${key}${variables ? JSON.stringify(variables) : ''}`;

  it('reads a wrong code as invalid, keeps the code usable, and never says whether the account exists', () => {
    expect(otpFailure({ status: 400, code: 'INVALID_OTP', message: 'Invalid OTP' }, null, tv, 'invalid', 'en')).toEqual({
      message: 'invalid',
      needsNewCode: false,
      waitSeconds: null,
    });
  });

  it('asks for a new code once Better Auth locks the code (403 TOO_MANY_ATTEMPTS)', () => {
    expect(otpFailure({ status: 403, code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts' }, null, tv, 'invalid', 'en')).toEqual({
      message: 't:auth.otp.codeLocked',
      needsNewCode: true,
      waitSeconds: null,
    });
  });

  it('gives the rate limiter’s wait in the interface language when the server sent one (429)', () => {
    expect(otpFailure({ status: 429, message: 'Too many requests. Please try again later.' }, 287, tv, 'invalid', 'en')).toEqual({
      message: 't:auth.otp.waitBeforeRetry{"wait":"5 minutes"}',
      needsNewCode: true,
      waitSeconds: 287,
    });
    expect(otpFailure({ status: 429 }, null, tv, 'invalid', 'en').message).toBe('t:auth.otp.tooManyAttempts');
  });

  it('formats short waits in seconds and longer ones in whole minutes, rounded up', () => {
    expect(formatWait(30, 'en')).toBe('30 seconds');
    expect(formatWait(61, 'en')).toBe('2 minutes');
    expect(formatWait(300, 'de')).toBe('5 Minuten');
  });

  it.each([
    ['the API limiter', 'Retry-After'],
    ['Better Auth', 'X-Retry-After'],
  ])('reads the wait %s sends (%s) from the response the auth client hands its onError', (_source, header) => {
    expect([retryAfterSeconds('42'), retryAfterSeconds('0'), retryAfterSeconds('soon'), retryAfterSeconds(null)]).toEqual([42, null, null, null]);
    const wait = rateLimitWait();
    expect(wait.retryAfter()).toBeNull();
    wait.fetchOptions.onError({ response: new Response(null, { status: 429, headers: { [header]: '120' } }) });
    expect(wait.retryAfter()).toBe(120);
  });
});
