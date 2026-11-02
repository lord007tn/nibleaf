import { createHash } from 'node:crypto';
import { AUTH_OTP_EXPIRY_SECONDS } from '@nibleaf/bullmq/jobs/email';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authOtpEmailMetadata, deliverAuthOtpEmail } from './auth-email-expiry';

const code = '123456';
const value = `${createHash('sha256').update(code).digest('base64url')}:0`;
const request = { email: 'Recipient@Example.test', otp: code, type: 'sign-in' as const };

afterEach(() => vi.useRealTimers());

describe('auth OTP email deadline', () => {
  it.each(['sign-in', 'email-verification', 'forget-password'] as const)('uses the stored expiry for %s before rendering', async (type) => {
    const expiresAt = new Date('2026-10-15T12:05:00Z');
    const findVerificationValue = vi.fn().mockResolvedValue({ value, expiresAt });
    const result = await authOtpEmailMetadata({ ...request, type }, { context: { internalAdapter: { findVerificationValue } } });
    expect(findVerificationValue).toHaveBeenCalledWith(`${type}-otp-recipient@example.test`);
    expect(result).toEqual({ purpose: 'otp', expiresAt: expiresAt.getTime() });
  });

  it('uses both current and new addresses for a change-email verification record', async () => {
    const expiresAt = new Date('2026-10-15T12:05:00Z');
    const findVerificationValue = vi.fn().mockResolvedValue({ value, expiresAt });
    const result = await authOtpEmailMetadata(
      { ...request, type: 'change-email' },
      { context: { session: { user: { email: 'Current@Example.test' } }, internalAdapter: { findVerificationValue } } },
    );
    expect(findVerificationValue).toHaveBeenCalledWith('change-email-otp-current@example.test-recipient@example.test');
    expect(result?.expiresAt).toBe(expiresAt.getTime());
  });

  it('does not enqueue a code consumed or replaced by a concurrent resend', async () => {
    const findVerificationValue = vi.fn().mockResolvedValue(null);
    expect(await authOtpEmailMetadata(request, { context: { internalAdapter: { findVerificationValue } } })).toBeNull();
    findVerificationValue.mockResolvedValue({ value: 'a-different-code-hash:0', expiresAt: new Date(Date.now() + 600_000) });
    expect(await authOtpEmailMetadata(request, { context: { internalAdapter: { findVerificationValue } } })).toBeNull();
    const renderAndEnqueue = vi.fn();
    expect(await deliverAuthOtpEmail(request, { context: { internalAdapter: { findVerificationValue } } }, renderAndEnqueue)).toBe(false);
    expect(renderAndEnqueue).not.toHaveBeenCalled();
  });

  it('passes the stored absolute deadline through slow rendering and enqueue without extending it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    const expiresAt = new Date('2026-10-15T12:10:00Z');
    const findVerificationValue = vi.fn().mockResolvedValue({ value, expiresAt });
    const enqueue = vi.fn();
    const renderAndEnqueue = async (metadata: { purpose: 'otp'; expiresAt: number }) => {
      vi.setSystemTime(new Date('2026-10-15T12:06:00Z'));
      await enqueue(metadata);
    };
    expect(await deliverAuthOtpEmail(request, { context: { internalAdapter: { findVerificationValue } } }, renderAndEnqueue)).toBe(true);
    expect(enqueue).toHaveBeenCalledWith({ purpose: 'otp', expiresAt: expiresAt.getTime() });
  });

  it('keeps optional-context callbacks compatible with a bounded pre-render deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    const startedAt = Date.now();
    const metadata = await authOtpEmailMetadata(request);
    vi.setSystemTime(new Date('2026-10-15T12:06:00Z'));
    expect(metadata).toEqual({ purpose: 'otp', expiresAt: startedAt + AUTH_OTP_EXPIRY_SECONDS * 1000 - 1000 });
  });

  it('does not reset a fallback deadline after an optional adapter read stalls and fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    const startedAt = Date.now();
    const findVerificationValue = vi.fn().mockImplementation(() => {
      vi.setSystemTime(new Date('2026-10-15T12:03:00Z'));
      throw new Error('Private adapter detail');
    });
    expect(await authOtpEmailMetadata(request, { context: { internalAdapter: { findVerificationValue } } })).toEqual({
      purpose: 'otp',
      expiresAt: startedAt + AUTH_OTP_EXPIRY_SECONDS * 1000 - 1000,
    });
  });
});
