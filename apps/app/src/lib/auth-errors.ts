interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

/** The interface copy `friendlyAuthError` can choose instead of the caller's fallback. */
type AuthErrorKey =
  | 'auth.otp.tooManyAttempts'
  | 'auth.otp.codeLocked'
  | 'auth.error.suspended'
  | 'auth.error.serverError'
  | 'auth.legal.termsRequired'
  | 'auth.legal.signupClosed';

/** The interface copy `friendlyEmailChangeError` can choose on top of {@link AuthErrorKey}. */
type EmailChangeErrorKey = AuthErrorKey | 'validation.emailInvalid' | 'settings.account.email.sameAsCurrent' | 'settings.account.email.inUse';

const errorCode = (error: AuthErrorLike | null | undefined) => (error?.code ?? '').toUpperCase();

/**
 * Better Auth's email-OTP plugin (1.7) answers the fourth guess at one code with
 * 403 `TOO_MANY_ATTEMPTS` and deletes the code, so only a new code helps; a later
 * guess at the deleted code reads as `INVALID_OTP`.
 */
export const isCodeLockedError = (error: AuthErrorLike | null | undefined): boolean => errorCode(error) === 'TOO_MANY_ATTEMPTS';

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
  if (isCodeLockedError(error)) return t('auth.otp.codeLocked');
  if (error?.status === 429 || code.includes('TOO_MANY')) return t('auth.otp.tooManyAttempts');
  // The email queue's stable code already has an operation-specific fallback ("Could not send a code").
  if (code === 'AUTH_EMAIL_UNAVAILABLE') return fallback;
  if ((error?.status ?? 0) >= 500) return t('auth.error.serverError');
  return fallback;
}

/** The longest wait a rate-limit answer can impose on the screen. */
const MAX_RETRY_AFTER_SECONDS = 3600;

/**
 * The seconds a rate-limit answer asked to wait, or null. `Retry-After` is
 * either delta-seconds ("120") or an HTTP-date; anything else, a past date,
 * zero or a negative value is ignored, and a longer wait is capped so a bad
 * header can never disable "Resend" for good.
 */
export const retryAfterSeconds = (header: string | null | undefined, now = Date.now()): number | null => {
  const value = header?.trim();
  if (!value) return null;
  let seconds: number;
  if (/^\d{1,10}$/.test(value)) seconds = Number(value);
  else {
    const at = Date.parse(value);
    // An HTTP-date names a weekday and a month; a bare number or other text is not one.
    if (!Number.isFinite(at) || !/[a-z]{3}/i.test(value)) return null;
    seconds = Math.ceil((at - now) / 1000);
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
};

/**
 * Better Auth's client returns `{ error }` without the response headers. Pass
 * `fetchOptions` as the call's second argument, then read `retryAfter()`. Two
 * limiters can answer 429 on the auth routes: the API's per-IP limit on
 * `/api/auth/*` (standard `Retry-After`) and Better Auth's per-endpoint one
 * (`X-Retry-After`).
 */
export function rateLimitWait() {
  let header: string | null = null;
  return {
    fetchOptions: {
      onError: ({ response }: { response: Response }) => {
        header = response.headers.get('Retry-After') ?? response.headers.get('X-Retry-After');
      },
    },
    retryAfter: () => retryAfterSeconds(header),
  };
}

/** "30 seconds" or "5 minutes" (rounded up), in the interface language. */
export const formatWait = (seconds: number, locale: string): string => {
  const [value, unit] = seconds < 60 ? [seconds, 'second'] : [Math.ceil(seconds / 60), 'minute'];
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(value);
};

type OtpErrorKey = AuthErrorKey | 'auth.otp.waitBeforeRetry';

/** What a failed code request or check means for the code step. */
export type OtpFailure = {
  message: string;
  /** The code can't be used any more (locked, or rate-limited after the allowed guesses): a new code is the way on. */
  needsNewCode: boolean;
  /** Seconds the server asked to wait, when it said. */
  waitSeconds: number | null;
};

/**
 * The code step's reading of an error: a locked code asks for a new one, a
 * rate limit says how long to wait when the server said, and everything else
 * follows {@link friendlyAuthError}. None of these say whether the address has
 * an account.
 */
export function otpFailure(
  error: AuthErrorLike | null | undefined,
  waitSeconds: number | null,
  t: (key: OtpErrorKey, variables?: Record<string, string | number>) => string,
  fallback: string,
  locale: string,
): OtpFailure {
  if (isCodeLockedError(error)) return { message: t('auth.otp.codeLocked'), needsNewCode: true, waitSeconds: null };
  if (error?.status === 429) {
    const message = waitSeconds ? t('auth.otp.waitBeforeRetry', { wait: formatWait(waitSeconds, locale) }) : t('auth.otp.tooManyAttempts');
    return { message, needsNewCode: true, waitSeconds };
  }
  return { message: friendlyAuthError(error, t, fallback), needsNewCode: false, waitSeconds: null };
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
