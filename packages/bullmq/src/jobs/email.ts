export type EmailJobName = 'send-email';

export interface SendEmailJobData {
  to: string;
  subject: string;
  html: string;
  text?: string;
}
