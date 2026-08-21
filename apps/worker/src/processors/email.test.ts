import type { SendEmailJobData } from '@nibleaf/bullmq/jobs/email';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  smtpSend: vi.fn(),
}));

vi.mock('@/env', () => ({ env: mocks.env }));
vi.mock('@nibleaf/logger', () => ({ createLogger: () => mocks.log }));
vi.mock('postmark', () => ({
  Models: { LinkTrackingOptions: { None: 'None' } },
  ServerClient: class {
    sendEmail = mocks.postmarkSend;
  },
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail: mocks.smtpSend }),
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
  beforeEach(() => {
    mocks.env.POSTMARK_API_KEY = undefined;
    mocks.env.POSTMARK_MESSAGE_STREAM = undefined;
    mocks.env.SMTP_URL = undefined;
    mocks.env.EMAIL_DELIVERY_REQUIRED = false;
    vi.clearAllMocks();
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
  });

  it('records the Postmark message ID without logging recipient data', async () => {
    mocks.env.POSTMARK_API_KEY = 'server-token';
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
  });

  it('uses the SMTP fallback without logging recipient data', async () => {
    mocks.env.SMTP_URL = 'smtp://localhost';
    mocks.env.EMAIL_DELIVERY_REQUIRED = true;
    mocks.smtpSend.mockResolvedValue({ messageId: 'smtp-message-123' });

    await expect(handleEmailJobs(job)).resolves.toEqual({ sent: true });
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
});
