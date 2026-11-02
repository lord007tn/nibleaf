import { AUTH_OTP_EXPIRY_SECONDS, type SendEmailJobData } from '@nibleaf/bullmq/jobs/email';

/**
 * Exact historic OTP subjects only: EN/AR catalog email_otp_*_subject keys,
 * plus the pre-localization verification subject shipped in #71 (3f5a3b5).
 * Do not infer auth from generic words such as "code", "verify", or "sign-in":
 * optional notifications and unrelated transactional mail must keep working.
 */
const legacyOtpSubjects = new Set([
  'Your Nibleaf sign-in code',
  'Your Nibleaf code to change your email',
  'Your Nibleaf email verification code',
  'Your Nibleaf password reset code',
  'Your Nibleaf code to verify your email',
  'رمز تسجيل الدخول إلى نيبليف',
  'رمز نيبليف لتغيير بريدك الإلكتروني',
  'رمز نيبليف لتأكيد بريدك الإلكتروني',
  'رمز إعادة تعيين كلمة مرور نيبليف',
]);

/** Check issuance time, never processedOn/retry time, before any provider work. */
export function authEmailSkipReason(data: SendEmailJobData, timestamp: number, now = Date.now()): string | null {
  if (data.auth !== undefined) {
    const expiresAt = data.auth?.expiresAt;
    if (data.auth?.purpose !== 'otp' || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) {
      return 'invalid-auth-expiry';
    }
    return expiresAt <= now ? 'expired-auth-otp' : null;
  }
  if (!legacyOtpSubjects.has(data.subject)) {
    return null;
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now) {
    return 'invalid-legacy-auth-timestamp';
  }
  return timestamp + AUTH_OTP_EXPIRY_SECONDS * 1000 <= now ? 'expired-legacy-auth-otp' : null;
}
