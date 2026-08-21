import type { SendEmailJobData } from '@nibleaf/bullmq/jobs/email';
import { createLogger } from '@nibleaf/logger';
import type { Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { ServerClient } from 'postmark';
import { env } from '@/env';
import { resolveEmailDelivery } from './email-delivery';
import { postmarkPrivacyOptions } from './email-options';

const log = createLogger({ processor: 'email' });

/**
 * Deliver an email. Postmark is preferred when configured; SMTP remains a
 * generic fallback for self-hosters. Required delivery fails closed when no
 * provider is configured so BullMQ can retry and surface the outage.
 */
export async function handleEmailJobs(job: Job<SendEmailJobData>): Promise<{ sent: boolean }> {
  const { to, subject, html, text } = job.data;
  const delivery = resolveEmailDelivery({
    postmarkApiKey: env.POSTMARK_API_KEY,
    smtpUrl: env.SMTP_URL,
    required: env.EMAIL_DELIVERY_REQUIRED,
  });

  try {
    if (delivery.provider === 'postmark' && env.POSTMARK_API_KEY) {
      const client = new ServerClient(env.POSTMARK_API_KEY);
      const response = await client.sendEmail({
        From: env.EMAIL_FROM,
        To: to,
        Subject: subject,
        HtmlBody: html,
        TextBody: text,
        ...postmarkPrivacyOptions,
        ...(env.POSTMARK_MESSAGE_STREAM ? { MessageStream: env.POSTMARK_MESSAGE_STREAM } : {}),
      });
      log.info({ jobId: job.id, messageId: response.MessageID, provider: 'postmark' }, 'email sent');
      return { sent: true };
    }

    if (!delivery.provider) {
      if (delivery.required) {
        throw new Error('Email delivery is required, but neither POSTMARK_API_KEY nor SMTP_URL is configured.');
      }

      log.info({ jobId: job.id }, 'email delivery is optional and no provider is configured');
      return { sent: false };
    }

    if (!env.SMTP_URL) {
      throw new Error('SMTP was selected but SMTP_URL is unavailable.');
    }

    const transport = nodemailer.createTransport(env.SMTP_URL);
    const response = await transport.sendMail({ from: env.EMAIL_FROM, to, subject, html, text });
    log.info({ jobId: job.id, messageId: response.messageId, provider: 'smtp' }, 'email sent');
    return { sent: true };
  } catch (error) {
    log.error({ error, jobId: job.id, provider: delivery.provider ?? 'none' }, 'email delivery failed');
    throw error;
  }
}
