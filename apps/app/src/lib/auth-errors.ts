interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

/** The interface copy `friendlyAuthError` can choose instead of the caller's fallback. */
type AuthErrorKey =
  | 'auth.otp.tooManyAttempts'
  | 'auth.error.suspended'
  | 'auth.error.serverError'
  | 'auth.legal.termsRequired'
  | 'auth.legal.signupClosed';

/** The interface copy `friendlyEmailChangeError` can choose on top of {@link AuthErrorKey}. */
type EmailChangeErrorKey = AuthErrorKey | 'validation.emailInvalid' | 'settings.account.email.sameAsCurrent' | 'settings.account.email.inUse';

const errorCode = (error: AuthErrorLike | null | undefined) => (error?.code ?? '').toUpperCase();

/**
 * The account can't sign in: suspended by moderation (the session hook in
 * `packages/auth/src/server.ts` throws a code-less 403 whose message says so) or
 * banned through Better Auth's admin plugin (`BANNED_USER`).
 */
export function isAccountSuspendedError(error: AuthErrorLike | null | undefined): boolean {
  const code = errorCode(error);
  if (code === 'BANNED_USER' || code.includes('SUSPENDED')) return true;
  return error?.status === 403 && /suspend|banned/i.test(error.message ?? '');
}

/**
 * One policy for every auth screen. Better Auth's `error.message` is English,
 * technical copy, so the screen shows localized text chosen from the error's
 * code/status: a suspended account is told to contact support, rate limits say
 * to wait, server failures say the problem is on our side (not the person's
 * connection: a request that never arrived throws instead, and callers show
 * `auth.error.tryAgain` for that), and anything else gets the operation's own
 * `fallback` (for example "That code is invalid or expired").
 */
export function friendlyAuthError(error: AuthErrorLike | null | undefined, t: (key: AuthErrorKey) => string, fallback: string): string {
  const code = errorCode(error);
  if (code === 'TERMS_REQUIRED') return t('auth.legal.termsRequired');
  if (code === 'SIGNUP_CLOSED') return t('auth.legal.signupClosed');
  if (isAccountSuspendedError(error)) return t('auth.error.suspended');
  if (error?.status === 429 || code.includes('TOO_MANY')) return t('auth.otp.tooManyAttempts');
  // The email queue's stable code already has an operation-specific fallback ("Could not send a code").
  if (code === 'AUTH_EMAIL_UNAVAILABLE') return fallback;
  if ((error?.status ?? 0) >= 500) return t('auth.error.serverError');
  return fallback;
}

/**
 * Account settings → change email. Besides code errors, Better Auth rejects the
 * new address itself with code-less English text: "Email is the same" (it's the
 * current address), `INVALID_EMAIL`, and — only at the last step — "Email already
 * in use". Those get their own message instead of "the code is invalid", so a
 * writer isn't sent to request codes that can never work.
 */
export function friendlyEmailChangeError(error: AuthErrorLike | null | undefined, t: (key: EmailChangeErrorKey) => string, fallback: string): string {
  const code = errorCode(error);
  const message = error?.message ?? '';
  if (code === 'INVALID_EMAIL') return t('validation.emailInvalid');
  if (/email is the same/i.test(message)) return t('settings.account.email.sameAsCurrent');
  if (code.includes('ALREADY') || /already (in use|exists)/i.test(message)) return t('settings.account.email.inUse');
  return friendlyAuthError(error, t, fallback);
}

/** Whether `next` is the address the account already uses (Better Auth compares lowercased). */
export const isSameEmail = (current: string, next: string) => current.trim().toLowerCase() === next.trim().toLowerCase();

/** Better Auth returns this error when credentials are valid but verification is still required. */
export function isEmailNotVerifiedError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) {
    return false;
  }
  const value = `${error.code ?? ''} ${error.message ?? ''}`.toUpperCase().replaceAll(' ', '_');
  return value.includes('EMAIL_NOT_VERIFIED');
}
