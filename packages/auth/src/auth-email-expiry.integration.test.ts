import { AUTH_OTP_EXPIRY_SECONDS } from '@nibleaf/bullmq/jobs/email';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { emailOTP } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { authOtpEmailMetadata } from './auth-email-expiry';

describe('installed Better Auth OTP delivery contract', () => {
  it('finds the hashed verification and its original expiry in the actual callback', async () => {
    const verification: Record<string, unknown>[] = [];
    const data: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification };
    const captured: Array<{ storedExpiry: number; emailExpiry: number | undefined; code: string; type: string }> = [];
    const auth = betterAuth({
      secret: 'synthetic-auth-expiry-secret-at-least-32-characters',
      baseURL: 'http://localhost:3000',
      database: memoryAdapter(data),
      plugins: [
        emailOTP({
          expiresIn: AUTH_OTP_EXPIRY_SECONDS,
          storeOTP: 'hashed',
          resendStrategy: 'rotate',
          changeEmail: { enabled: true, verifyCurrentEmail: true },
          async sendVerificationOTP(request, context) {
            const recipient = request.type === 'change-email' ? `${context?.context.session?.user.email}-${request.email}` : request.email;
            const stored = await context?.context.internalAdapter.findVerificationValue(`${request.type}-otp-${recipient}`);
            if (!(stored?.expiresAt instanceof Date)) throw new Error('OTP must be persisted before email delivery');
            const metadata = await authOtpEmailMetadata(request, context);
            captured.push({ storedExpiry: stored.expiresAt.getTime(), emailExpiry: metadata?.expiresAt, code: request.otp, type: request.type });
          },
        }),
      ],
    });
    const startedAt = Date.now();
    await auth.api.sendVerificationOTP({ body: { email: 'synthetic@example.test', type: 'sign-in' } });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.emailExpiry).toBe(captured[0]?.storedExpiry);
    expect(captured[0]?.emailExpiry).toBeGreaterThanOrEqual(startedAt + AUTH_OTP_EXPIRY_SECONDS * 1000);
    expect(verification[0]?.value).not.toMatch(/^\d{6}:/);

    const signIn = await auth.api.signInEmailOTP({ body: { email: 'synthetic@example.test', otp: captured[0]?.code ?? '' }, asResponse: true });
    expect(signIn.status).toBe(200);
    const headers = new Headers({
      cookie: signIn.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    });
    await auth.api.sendVerificationOTP({ body: { email: 'synthetic@example.test', type: 'email-verification' }, headers });
    await auth.api.requestPasswordResetEmailOTP({ body: { email: 'synthetic@example.test' } });
    const verificationCode = captured.find((item) => item.type === 'email-verification')?.code ?? '';
    await auth.api.requestEmailChangeEmailOTP({ body: { newEmail: 'changed@example.test', otp: verificationCode }, headers });
    expect(captured.map((item) => item.type)).toEqual(['sign-in', 'email-verification', 'forget-password', 'change-email']);
    for (const item of captured) expect(item.emailExpiry).toBe(item.storedExpiry);
    expect(captured.find((item) => item.type === 'change-email')?.emailExpiry).toBeGreaterThan(startedAt);
  });
});
