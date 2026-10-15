import { createHash } from 'node:crypto';
import { AUTH_OTP_EXPIRY_SECONDS, type SendEmailJobData } from '@nibleaf/bullmq/jobs/email';

type OtpPurpose = 'change-email' | 'email-verification' | 'forget-password' | 'sign-in';
interface OtpContext {
  context?: {
    internalAdapter?: {
      findVerificationValue(identifier: string): Promise<{ expiresAt: Date; value: string } | null>;
    };
    session?: { user: { email: string } } | null;
  };
}

/** Prepare the deadline before rendering/queueing; obsolete callbacks do neither. */
export async function deliverAuthOtpEmail(
  request: { email: string; otp: string; type: OtpPurpose },
  context: OtpContext | undefined,
  deliver: (auth: NonNullable<SendEmailJobData['auth']>) => Promise<void>,
): Promise<boolean> {
  const auth = await authOtpEmailMetadata(request, context);
  if (!auth) return false;
  await deliver(auth);
  return true;
}

/**
 * Better Auth 1.7 stores the hashed verification before calling delivery. Match
 * that hash so a racing resend cannot lend this code its later expiry. A
 * consumed/rotated code needs no email. Optional-context integrations retain a
 * bounded fallback captured before rendering, never after it or at queue retry.
 */
export async function authOtpEmailMetadata(
  { email, otp, type }: { email: string; otp: string; type: OtpPurpose },
  context?: OtpContext,
): Promise<SendEmailJobData['auth'] | null> {
  const fallbackDeadline = Date.now() + AUTH_OTP_EXPIRY_SECONDS * 1000 - 1000;
  const adapter = context?.context?.internalAdapter;
  const currentEmail = context?.context?.session?.user.email;
  const recipient = email.toLowerCase();
  const identifier = type === 'change-email' ? (currentEmail ? `${currentEmail.toLowerCase()}-${recipient}` : null) : recipient;
  if (adapter && identifier) {
    try {
      const record = await adapter.findVerificationValue(`${type}-otp-${identifier}`);
      if (!record) {
        return null;
      }
      const storedHash = record.value.slice(0, record.value.lastIndexOf(':'));
      if (storedHash !== createHash('sha256').update(otp).digest('base64url')) {
        return null;
      }
      const expiresAt = record.expiresAt.getTime();
      if (Number.isFinite(expiresAt)) {
        return { purpose: 'otp', expiresAt };
      }
    } catch {
      // Context is optional in Better Auth's delivery contract. A read failure
      // must not create a new sign-in outage; the worker still has a hard limit.
    }
  }
  return { purpose: 'otp', expiresAt: fallbackDeadline };
}
