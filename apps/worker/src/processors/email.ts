import type { SendEmailJobData } from '@nibleaf/bullmq/jobs/email';
import { createLogger } from '@nibleaf/logger';
import type { Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { ServerClient } from 'postmark';
import { env } from '@/env';
import { postmarkPrivacyOptions } from './email-options';

const log = createLogger({ processor: 'email' });

/**
 * Deliver an email. Postmark is preferred when configured; SMTP remains a
 * generic fallback for self-hosters. Without either, messages are logged.
 */
export async function handleEmailJobs(job: Job<SendEmailJobData>): Promise<{ sent: boolean }> {
  const { to, subject, html, text } = job.data;
  try {
    if (env.POSTMARK_API_KEY) {
      const client = new ServerClient(env.POSTMARK_API_KEY);
      await client.sendEmail({
        From: env.EMAIL_FROM,
        To: to,
        Subject: subject,
        HtmlBody: html,
        TextBody: text,
        ...postmarkPrivacyOptions,
        ...(env.POSTMARK_MESSAGE_STREAM ? { MessageStream: env.POSTMARK_MESSAGE_STREAM } : {}),
      });
      log.info({ to, subject, from: env.EMAIL_FROM, provider: 'postmark' }, 'email sent');
      return { sent: true };
    }

    if (!env.SMTP_URL) {
      log.info({ to, subject, from: env.EMAIL_FROM }, 'email (dev: logged, not sent — set POSTMARK_API_KEY or SMTP_URL to deliver)');
      return { sent: false };
    }

    const transport = nodemailer.createTransport(env.SMTP_URL);
    await transport.sendMail({ from: env.EMAIL_FROM, to, subject, html, text });
    log.info({ to, subject, from: env.EMAIL_FROM, provider: 'smtp' }, 'email sent');
    return { sent: true };
  } catch (error) {
    log.error({ error, to, subject }, 'email delivery failed');
    throw error;
  }
}
