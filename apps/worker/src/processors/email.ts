import type { SendEmailJobData } from '@midad/bullmq/jobs/email';
import { createLogger } from '@midad/logger';
import type { Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { env } from '@/env';

const log = createLogger({ processor: 'email' });

/**
 * Deliver an email. Without SMTP_URL configured (the default in dev/self-host)
 * the message is logged instead of sent, so flows that send mail never fail.
 */
export async function handleEmailJobs(job: Job<SendEmailJobData>): Promise<{ sent: boolean }> {
  const { to, subject, html, text } = job.data;
  if (!env.SMTP_URL) {
    log.info({ to, subject, from: env.EMAIL_FROM }, 'email (dev: logged, not sent — set SMTP_URL to deliver)');
    return { sent: false };
  }
  try {
    const transport = nodemailer.createTransport(env.SMTP_URL);
    await transport.sendMail({ from: env.EMAIL_FROM, to, subject, html, text });
    log.info({ to, subject, from: env.EMAIL_FROM }, 'email sent');
    return { sent: true };
  } catch (error) {
    log.error({ error, to, subject }, 'email delivery failed');
    throw error;
  }
}
