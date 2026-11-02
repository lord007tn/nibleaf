import type { SendEmailJobData } from '@nibleaf/bullmq/jobs/email';
import { createLogger } from '@nibleaf/logger';
import type { Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { ServerClient } from 'postmark';
import { env } from '@/env';
import { resolveEmailDelivery } from './email-delivery';
import { authEmailSkipReason } from './email-expiry';
import { postmarkPrivacyOptions } from './email-options';

const log = createLogger({ processor: 'email' });

/**
 * Deliver an email. Postmark is preferred when configured; SMTP remains a
 * generic fallback for self-hosters. Required delivery fails closed when no
 * provider is configured so BullMQ can retry and surface the outage.
 */
export async function handleEmailJobs(job: Job<SendEmailJobData>): Promise<{ sent: boolean }> {
  const skipReason = authEmailSkipReason(job.data, job.timestamp);
  if (skipReason) {
    log.info({ jobId: job.id, reason: skipReason }, 'auth email skipped before delivery');
    return { sent: false };
  }
  return deliverEmail(job.data, job.id);
}

/** Also used directly for operations alerts when the email queue is unavailable. */
export async function deliverEmail({ to, subject, html, text }: SendEmailJobData, jobId?: string): Promise<{ sent: boolean }> {
  const delivery = resolveEmailDelivery({
    postmarkApiKey: env.POSTMARK_API_KEY,
    smtpUrl: env.SMTP_URL,
    required: env.EMAIL_DELIVERY_REQUIRED,
  });

  try {
    if (delivery.provider === 'postmark' && env.POSTMARK_API_KEY) {
      const client = new ServerClient(env.POSTMARK_API_KEY, { timeout: 5 });
      const response = await client.sendEmail({
        From: env.EMAIL_FROM,
        To: to,
        Subject: subject,
        HtmlBody: html,
        TextBody: text,
        ...postmarkPrivacyOptions,
        ...(env.POSTMARK_MESSAGE_STREAM ? { MessageStream: env.POSTMARK_MESSAGE_STREAM } : {}),
      });
      log.info({ jobId, messageId: response.MessageID, provider: 'postmark' }, 'email sent');
      return { sent: true };
    }

    if (!delivery.provider) {
      if (delivery.required) {
        throw new Error('Email delivery is required, but neither POSTMARK_API_KEY nor SMTP_URL is configured.');
      }

      log.info({ jobId }, 'email delivery is optional and no provider is configured');
      return { sent: false };
    }

    if (!env.SMTP_URL) {
      throw new Error('SMTP was selected but SMTP_URL is unavailable.');
    }

    const smtpUrl = new URL(env.SMTP_URL);
    for (const option of ['connectionTimeout', 'greetingTimeout', 'socketTimeout', 'dnsTimeout']) {
      if (!smtpUrl.searchParams.has(option)) smtpUrl.searchParams.set(option, '5000');
    }
    const transport = nodemailer.createTransport(smtpUrl.href);
    try {
      const response = await transport.sendMail({ from: env.EMAIL_FROM, to, subject, html, text });
      if (Array.isArray(response.accepted) && response.accepted.length === 0) throw new Error('SMTP did not accept the recipient.');
      log.info({ jobId, messageId: response.messageId, provider: 'smtp' }, 'email sent');
      return { sent: true };
    } finally {
      transport.close();
    }
  } catch (error) {
    log.error({ jobId, provider: delivery.provider ?? 'none' }, 'email delivery failed');
    throw error;
  }
}
