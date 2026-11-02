import type { SendEmailJobData } from '@nibleaf/bullmq/jobs/email';
import { describe, expect, it } from 'vitest';
import { authEmailSkipReason } from './email-expiry';

const now = new Date('2026-10-15T12:00:00Z').getTime();
const email = { to: 'private@example.test', subject: '', html: '<p>Private message</p>' } satisfies SendEmailJobData;

describe('legacy OTP expiry compatibility', () => {
  it.each([
    'Your Nibleaf sign-in code',
    'Your Nibleaf code to change your email',
    'Your Nibleaf email verification code',
    'Your Nibleaf password reset code',
    'Your Nibleaf code to verify your email',
    'رمز تسجيل الدخول إلى نيبليف',
    'رمز نيبليف لتغيير بريدك الإلكتروني',
    'رمز نيبليف لتأكيد بريدك الإلكتروني',
    'رمز إعادة تعيين كلمة مرور نيبليف',
  ])('uses the original enqueue timestamp only for shipped OTP subject %s', (subject) => {
    const data = { ...email, subject };
    expect(authEmailSkipReason(data, now - 600_000, now)).toBe('expired-legacy-auth-otp');
    expect(authEmailSkipReason(data, now - 599_999, now)).toBeNull();
    expect(authEmailSkipReason(data, Number.NaN, now)).toBe('invalid-legacy-auth-timestamp');
    expect(authEmailSkipReason(data, undefined as unknown as number, now)).toBe('invalid-legacy-auth-timestamp');
  });

  it.each([
    'New sign-in to your Nibleaf account',
    'Verify your email',
    'Your Nibleaf discount code',
    'Your Nibleaf sign-in code reminder',
    'رمز خصم نيبليف',
  ])('preserves ordinary old email %s', (subject) => {
    expect(authEmailSkipReason({ ...email, subject }, now - 90 * 86_400_000, now)).toBeNull();
    expect(authEmailSkipReason({ ...email, subject }, Number.NaN, now)).toBeNull();
  });
});
