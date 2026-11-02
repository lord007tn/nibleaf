export type EmailJobName = 'send-email';

/** Shared with Better Auth's OTP verification lifetime; measured from issuance. */
export const AUTH_OTP_EXPIRY_SECONDS = 10 * 60;

export interface SendEmailJobData {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Absolute verification deadline, preserved across queue waits and retries. */
  auth?: { purpose: 'otp'; expiresAt: number };
}
