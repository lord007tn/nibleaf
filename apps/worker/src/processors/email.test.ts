import type { SendEmailJobData } from '@nibleaf/bullmq/jobs/email';
import type { Job } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    POSTMARK_API_KEY: undefined as string | undefined,
    POSTMARK_MESSAGE_STREAM: undefined as string | undefined,
    SMTP_URL: undefined as string | undefined,
    EMAIL_DELIVERY_REQUIRED: false,
    EMAIL_FROM: 'Nibleaf <no-reply@nibleaf.com>',
  },
  log: {
    info: vi.fn(),
    error: vi.fn(),
  },
  postmarkSend: vi.fn(),
  postmarkCreate: vi.fn(),
  smtpSend: vi.fn(),
  smtpCreate: vi.fn(),
}));

vi.mock('@/env', () => ({ env: mocks.env }));
vi.mock('@nibleaf/logger', () => ({ createLogger: () => mocks.log }));
vi.mock('postmark', () => ({
  Models: { LinkTrackingOptions: { None: 'None' } },
  ServerClient: class {
    constructor() {
      mocks.postmarkCreate();
    }
    sendEmail = mocks.postmarkSend;
  },
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: mocks.smtpCreate,
  },
}));

import { handleEmailJobs } from './email';

const job = {
  id: 'email-job-1',
  data: {
    to: 'private-recipient@example.com',
    subject: 'Private subject',
    html: '<p>Hello</p>',
    text: 'Hello',
  },
} as Job<SendEmailJobData>;

describe('handleEmailJobs', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    mocks.env.POSTMARK_API_KEY = undefined;
    mocks.env.POSTMARK_MESSAGE_STREAM = undefined;
    mocks.env.SMTP_URL = undefined;
    mocks.env.EMAIL_DELIVERY_REQUIRED = false;
    vi.clearAllMocks();
    mocks.smtpCreate.mockReturnValue({ sendMail: mocks.smtpSend });
  });

  it('fails a required delivery when no provider is configured', async () => {
    mocks.env.EMAIL_DELIVERY_REQUIRED = true;

    await expect(handleEmailJobs(job)).rejects.toThrow('neither POSTMARK_API_KEY nor SMTP_URL');
    expect(mocks.log.error).toHaveBeenCalledWith({ jobId: 'email-job-1', provider: 'none' }, 'email delivery failed');
    expect(JSON.stringify(mocks.log.error.mock.calls)).not.toContain(job.data.to);
    expect(JSON.stringify(mocks.log.error.mock.calls)).not.toContain(job.data.subject);
  });

  it('allows an optional delivery to remain disabled', async () => {
    await expect(handleEmailJobs(job)).resolves.toEqual({ sent: false });
    expect(mocks.log.info).toHaveBeenCalledWith({ jobId: 'email-job-1' }, 'email delivery is optional and no provider is configured');
    expect(mocks.smtpCreate).not.toHaveBeenCalled();
    expect(mocks.postmarkSend).not.toHaveBeenCalled();
  });

  it('records the Postmark message ID without logging recipient data', async () => {
    mocks.env.POSTMARK_API_KEY = 'server-token';
    mocks.env.SMTP_URL = 'smtp://localhost';
    mocks.env.POSTMARK_MESSAGE_STREAM = 'outbound';
    mocks.env.EMAIL_DELIVERY_REQUIRED = true;
    mocks.postmarkSend.mockResolvedValue({ MessageID: 'message-123' });

    await expect(handleEmailJobs(job)).resolves.toEqual({ sent: true });
    expect(mocks.postmarkSend).toHaveBeenCalledWith(
      expect.objectContaining({
        To: job.data.to,
        Subject: job.data.subject,
        TrackLinks: 'None',
        TrackOpens: false,
        MessageStream: 'outbound',
      }),
    );
    expect(mocks.log.info).toHaveBeenCalledWith({ jobId: 'email-job-1', messageId: 'message-123', provider: 'postmark' }, 'email sent');
    expect(JSON.stringify(mocks.log.info.mock.calls)).not.toContain(job.data.to);
    expect(JSON.stringify(mocks.log.info.mock.calls)).not.toContain(job.data.subject);
    expect(mocks.smtpCreate).not.toHaveBeenCalled();
  });

  it('uses the SMTP fallback without logging recipient data', async () => {
    mocks.env.SMTP_URL = 'smtp://localhost';
    mocks.env.EMAIL_DELIVERY_REQUIRED = true;
    mocks.smtpSend.mockResolvedValue({ messageId: 'smtp-message-123' });

    await expect(handleEmailJobs(job)).resolves.toEqual({ sent: true });
    expect(mocks.smtpCreate).toHaveBeenCalledWith(mocks.env.SMTP_URL);
    expect(mocks.smtpSend).toHaveBeenCalledWith({
      from: mocks.env.EMAIL_FROM,
      to: job.data.to,
      subject: job.data.subject,
      html: job.data.html,
      text: job.data.text,
    });
    expect(mocks.log.info).toHaveBeenCalledWith({ jobId: 'email-job-1', messageId: 'smtp-message-123', provider: 'smtp' }, 'email sent');
    expect(JSON.stringify(mocks.log.info.mock.calls)).not.toContain(job.data.to);
    expect(JSON.stringify(mocks.log.info.mock.calls)).not.toContain(job.data.subject);
  });

  it('propagates SMTP failures for queue retry without logging message content', async () => {
    mocks.env.SMTP_URL = 'smtp://localhost';
    const error = new Error('SMTP recipient rejected');
    mocks.smtpSend.mockRejectedValue(error);

    await expect(handleEmailJobs(job)).rejects.toBe(error);
    expect(mocks.log.error).toHaveBeenCalledWith({ jobId: job.id, provider: 'smtp' }, 'email delivery failed');
    expect(mocks.log.info).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.log.error.mock.calls)).not.toContain(job.data.to);
    expect(JSON.stringify(mocks.log.error.mock.calls)).not.toContain(job.data.subject);
  });

  it('does not fall back to SMTP after a configured Postmark provider fails', async () => {
    mocks.env.POSTMARK_API_KEY = 'server-token';
    mocks.env.SMTP_URL = 'smtp://localhost';
    const error = new Error('Postmark request failed');
    mocks.postmarkSend.mockRejectedValue(error);

    await expect(handleEmailJobs(job)).rejects.toBe(error);
    expect(mocks.smtpCreate).not.toHaveBeenCalled();
    expect(mocks.log.error).toHaveBeenCalledWith({ jobId: job.id, provider: 'postmark' }, 'email delivery failed');
    expect(mocks.log.info).not.toHaveBeenCalled();
  });

  it.each(['postmark', 'smtp'] as const)('skips an OTP at its absolute expiry before constructing %s', async (provider) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    mocks.env.EMAIL_DELIVERY_REQUIRED = true;
    if (provider === 'postmark') mocks.env.POSTMARK_API_KEY = 'server-token';
    else mocks.env.SMTP_URL = 'smtp://localhost';
    const expired = { ...job, data: { ...job.data, auth: { purpose: 'otp' as const, expiresAt: Date.now() } } } as Job<SendEmailJobData>;
    await expect(handleEmailJobs(expired)).resolves.toEqual({ sent: false });
    expect(mocks.postmarkCreate).not.toHaveBeenCalled();
    expect(mocks.smtpCreate).not.toHaveBeenCalled();
    expect(mocks.log.info).toHaveBeenCalledWith({ jobId: job.id, reason: 'expired-auth-otp' }, 'auth email skipped before delivery');
    expect(JSON.stringify(mocks.log.info.mock.calls)).not.toContain(job.data.to);
    expect(JSON.stringify(mocks.log.info.mock.calls)).not.toContain(job.data.subject);
    expect(JSON.stringify(mocks.log.info.mock.calls)).not.toContain(job.data.html);
  });

  it('sends a fresh OTP once but stops its retry after the original deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    mocks.env.POSTMARK_API_KEY = 'server-token';
    mocks.postmarkSend.mockRejectedValueOnce(new Error('temporary provider failure'));
    const originalDeadline = Date.now() + 1000;
    const fresh = {
      ...job,
      timestamp: Date.now() - 60_000,
      data: { ...job.data, auth: { purpose: 'otp' as const, expiresAt: originalDeadline } },
    } as Job<SendEmailJobData>;
    await expect(handleEmailJobs(fresh)).rejects.toThrow('temporary provider failure');
    vi.setSystemTime(originalDeadline);
    await expect(handleEmailJobs({ ...fresh, attemptsMade: 1, processedOn: Date.now() } as Job<SendEmailJobData>)).resolves.toEqual({ sent: false });
    expect(mocks.postmarkSend).toHaveBeenCalledTimes(1);
  });

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
  ])('skips expired legacy OTP %s before constructing a provider', async (subject) => {
    mocks.env.POSTMARK_API_KEY = 'server-token';
    mocks.env.SMTP_URL = 'smtp://localhost';
    const expired = { ...job, timestamp: Date.now() - 600_000, data: { ...job.data, subject } } as Job<SendEmailJobData>;
    await expect(handleEmailJobs(expired)).resolves.toEqual({ sent: false });
    expect(mocks.postmarkCreate).not.toHaveBeenCalled();
    expect(mocks.smtpCreate).not.toHaveBeenCalled();
    expect(mocks.postmarkSend).not.toHaveBeenCalled();
    expect(mocks.smtpSend).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.log.info.mock.calls)).not.toContain(subject);
  });

  it('fails closed for malformed explicit auth expiry without affecting ordinary optional delivery', async () => {
    mocks.env.EMAIL_DELIVERY_REQUIRED = true;
    await expect(
      handleEmailJobs({ ...job, data: { ...job.data, auth: { purpose: 'otp', expiresAt: Number.NaN } } } as Job<SendEmailJobData>),
    ).resolves.toEqual({ sent: false });
    expect(mocks.postmarkCreate).not.toHaveBeenCalled();
    expect(mocks.smtpCreate).not.toHaveBeenCalled();
    expect(mocks.log.error).not.toHaveBeenCalled();
  });
});
