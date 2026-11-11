export type EmailJobName = 'send-email';

/** Shared with Better Auth's OTP verification lifetime; measured from issuance. */
export const AUTH_OTP_EXPIRY_SECONDS = 10 * 60;

export interface SendEmailJobData {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Absolute verification deadline, preserved across queue waits and retries. */
  auth?: { purpose: 'otp'; expiresAt: number /** Closed-instance sign-in: decide eligibility only in the worker. */; existingUserOnly?: boolean };
  /** Team-event mail is reauthorized after queue waits and retries. */
  teamAccess?: { userId: string; projectId: string; minimumRole: 'viewer' | 'admin'; notificationId?: string };
}
