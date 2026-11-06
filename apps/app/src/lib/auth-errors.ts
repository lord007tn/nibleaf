interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

/** The interface copy `friendlyAuthError` can choose instead of the caller's fallback. */
type AuthErrorKey = 'auth.otp.tooManyAttempts' | 'auth.error.suspended' | 'auth.error.tryAgain';

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
 * to wait, server failures say to try again, and anything else gets the
 * operation's own `fallback` (for example "That code is invalid or expired").
 */
export function friendlyAuthError(error: AuthErrorLike | null | undefined, t: (key: AuthErrorKey) => string, fallback: string): string {
  const code = errorCode(error);
  if (isAccountSuspendedError(error)) return t('auth.error.suspended');
  if (error?.status === 429 || code.includes('TOO_MANY')) return t('auth.otp.tooManyAttempts');
  // The email queue's stable code already has an operation-specific fallback ("Could not send a code").
  if (code === 'AUTH_EMAIL_UNAVAILABLE') return fallback;
  if ((error?.status ?? 0) >= 500) return t('auth.error.tryAgain');
  return fallback;
}

/** Better Auth returns this error when credentials are valid but verification is still required. */
export function isEmailNotVerifiedError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) {
    return false;
  }
  const value = `${error.code ?? ''} ${error.message ?? ''}`.toUpperCase().replaceAll(' ', '_');
  return value.includes('EMAIL_NOT_VERIFIED');
}
