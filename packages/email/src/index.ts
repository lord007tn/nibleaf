import { createElement } from 'react';
import { createEmailTranslator, DEFAULT_EMAIL_LANGUAGE, type EmailLanguage } from './i18n';
import { renderEmail } from './render';
import { TransactionalEmail } from './templates/transactional';

export type { EmailLanguage } from './i18n';
export { DEFAULT_EMAIL_LANGUAGE } from './i18n';
export { TransactionalEmail } from './templates/transactional';

export interface RenderedEmail {
  html: string;
  subject: string;
  text: string;
}

export async function renderVerificationCodeEmail({
  code,
  language = DEFAULT_EMAIL_LANGUAGE,
  purpose,
}: {
  code: string;
  language?: EmailLanguage;
  purpose: 'change-email' | 'email-verification' | 'forget-password' | 'sign-in';
}) {
  const { t } = createEmailTranslator(language);
  const prefix =
    purpose === 'sign-in'
      ? 'otp.signIn'
      : purpose === 'change-email'
        ? 'otp.changeEmail'
        : purpose === 'forget-password'
          ? 'otp.forgotPassword'
          : 'otp.verifyEmail';
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      code,
      detail: t('otp.expiry', { minutes: '10' }),
      language,
      message: t(`${prefix}.message`),
      preview: t(`${prefix}.preview`),
      title: t('otp.title'),
    }),
  );
  return {
    subject: t(`${prefix}.subject`)
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}

export async function renderEmailVerificationEmail({ language = DEFAULT_EMAIL_LANGUAGE, url }: { language?: EmailLanguage; url: string }) {
  const { t } = createEmailTranslator(language);
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      action: { label: t('verifyEmail.action'), url },
      detail: t('verifyEmail.detail'),
      language,
      message: t('verifyEmail.message'),
      preview: t('verifyEmail.preview'),
      title: t('verifyEmail.title'),
    }),
  );
  return {
    subject: t('verifyEmail.subject')
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}

export async function renderMemberJoinedEmail({
  language = DEFAULT_EMAIL_LANGUAGE,
  memberName,
  organizationName,
}: {
  language?: EmailLanguage;
  memberName: string;
  organizationName: string;
}) {
  const { t } = createEmailTranslator(language);
  const params = { memberName, organizationName };
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      language,
      message: t('memberJoined.message', params),
      preview: t('memberJoined.preview', params),
      title: t('memberJoined.title', params),
    }),
  );
  return {
    subject: t('memberJoined.subject', params)
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}

export async function renderNewSignInEmail({ ipAddress, language = DEFAULT_EMAIL_LANGUAGE }: { ipAddress?: string; language?: EmailLanguage }) {
  const { t } = createEmailTranslator(language);
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      detail: t('newSignIn.detail'),
      language,
      message: ipAddress ? t('newSignIn.withIp', { ipAddress }) : t('newSignIn.withoutIp'),
      preview: t('newSignIn.preview'),
      title: t('newSignIn.title'),
    }),
  );
  return {
    subject: t('newSignIn.subject')
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}

export async function renderMemberInvitationEmail({
  acceptUrl,
  days,
  inviterName,
  language = DEFAULT_EMAIL_LANGUAGE,
  organizationName,
  role,
}: {
  acceptUrl: string;
  days: number;
  inviterName: string;
  language?: EmailLanguage;
  organizationName: string;
  role: string;
}) {
  const { t } = createEmailTranslator(language);
  const params = { days: String(days), inviterName, organizationName, role };
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      action: { label: t('invite.action'), url: acceptUrl },
      detail: t('invite.expiry', params),
      language,
      message: t('invite.message', params),
      preview: t('invite.preview', params),
      title: t('invite.title', params),
    }),
  );
  return {
    subject: t('invite.subject', params)
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}

export async function renderReaderInvitationEmail({
  activationUrl,
  days,
  language = DEFAULT_EMAIL_LANGUAGE,
  projectName,
}: {
  activationUrl: string;
  days: number;
  language?: EmailLanguage;
  projectName: string;
}) {
  const { t } = createEmailTranslator(language);
  const params = { days: String(days), projectName };
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      action: { label: t('readerInvite.action'), url: activationUrl },
      detail: t('readerInvite.expiry', params),
      language,
      message: t('readerInvite.message', params),
      preview: t('readerInvite.preview', params),
      title: t('readerInvite.title'),
    }),
  );
  return {
    subject: t('readerInvite.subject', params)
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}

export async function renderDeploymentEmail({
  error,
  language = DEFAULT_EMAIL_LANGUAGE,
  outcome,
  projectName,
  siteUrl,
  version,
}: {
  error?: string;
  language?: EmailLanguage;
  outcome: 'failed' | 'ready';
  projectName: string;
  siteUrl?: string;
  version: number;
}) {
  const { t } = createEmailTranslator(language);
  const prefix = outcome === 'ready' ? 'deployment.ready' : 'deployment.failed';
  const params = { error: error ?? '', projectName, version: String(version) };
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      ...(outcome === 'ready' && siteUrl ? { action: { label: t('deployment.ready.action'), url: siteUrl } } : {}),
      ...(outcome === 'failed' && error ? { detail: t('deployment.failed.detail', params) } : {}),
      language,
      message: t(`${prefix}.message`, params),
      preview: t(`${prefix}.preview`, params),
      title: t(`${prefix}.title`, params),
    }),
  );
  return {
    subject: t(`${prefix}.subject`, params)
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}
