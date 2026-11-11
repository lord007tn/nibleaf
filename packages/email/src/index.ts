import { createElement } from 'react';
import { renderEmail } from './render';
import { TransactionalEmail } from './templates/transactional';
import { createEmailTranslator, DEFAULT_EMAIL_LANGUAGE, type EmailLanguage } from './translate';

export { TransactionalEmail } from './templates/transactional';
export type { EmailLanguage } from './translate';
export { createEmailTranslator, DEFAULT_EMAIL_LANGUAGE, resolveEmailLanguage } from './translate';

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
  const t = createEmailTranslator(language);
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
      detail: t('email.otp.expiry', { minutes: 10 }),
      language,
      message: t(`email.${prefix}.message`),
      preview: t(`email.${prefix}.preview`),
      title: t('email.otp.title'),
    }),
  );
  return {
    subject: t(`email.${prefix}.subject`)
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}

export async function renderEmailVerificationEmail({ language = DEFAULT_EMAIL_LANGUAGE, url }: { language?: EmailLanguage; url: string }) {
  const t = createEmailTranslator(language);
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      action: { label: t('email.verifyEmail.action'), url },
      detail: t('email.verifyEmail.detail'),
      language,
      message: t('email.verifyEmail.message'),
      preview: t('email.verifyEmail.preview'),
      title: t('email.verifyEmail.title'),
    }),
  );
  return {
    subject: t('email.verifyEmail.subject')
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
  const t = createEmailTranslator(language);
  const params = { memberName, organizationName };
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      language,
      message: t('email.memberJoined.message', params),
      preview: t('email.memberJoined.preview', params),
      title: t('email.memberJoined.title', params),
    }),
  );
  return {
    subject: t('email.memberJoined.subject', params)
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}

export async function renderNewSignInEmail({ ipAddress, language = DEFAULT_EMAIL_LANGUAGE }: { ipAddress?: string; language?: EmailLanguage }) {
  const t = createEmailTranslator(language);
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      detail: t('email.newSignIn.detail'),
      language,
      message: ipAddress ? t('email.newSignIn.withIp', { ipAddress }) : t('email.newSignIn.withoutIp'),
      preview: t('email.newSignIn.preview'),
      title: t('email.newSignIn.title'),
    }),
  );
  return {
    subject: t('email.newSignIn.subject')
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}

const INVITE_ROLE_LABELS: Record<string, 'roles.owner' | 'roles.admin' | 'roles.editor' | 'roles.viewer'> = {
  owner: 'roles.owner',
  admin: 'roles.admin',
  member: 'roles.editor',
  viewer: 'roles.viewer',
};

export async function renderMemberInvitationEmail({
  acceptUrl,
  days,
  inviterName,
  language = DEFAULT_EMAIL_LANGUAGE,
  organizationName,
  role,
  organizationRole = false,
  grants = [],
}: {
  acceptUrl: string;
  days: number;
  inviterName: string;
  language?: EmailLanguage;
  organizationName: string;
  role: string;
  organizationRole?: boolean;
  grants?: Array<{ name: string; role: string }>;
}) {
  const t = createEmailTranslator(language);
  // The sentence names the role in the reader's language, never the stored value.
  const params = {
    days,
    inviterName,
    organizationName,
    role: t(organizationRole && role === 'member' ? 'roles.organizationMember' : (INVITE_ROLE_LABELS[role] ?? 'roles.editor')),
  };
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      action: { label: t('email.invite.action'), url: acceptUrl },
      // What they get (design §6.1): Admin of everything, the websites with their role, or none yet.
      detail: [
        organizationRole && role === 'admin'
          ? t('email.invite.accessAdmin')
          : organizationRole && role === 'member' && !grants.length
            ? t('email.invite.accessNone')
            : grants.map((grant) => `${grant.name} (${t(INVITE_ROLE_LABELS[grant.role] ?? 'roles.viewer')})`).join(', '),
        t('email.invite.expiry', params),
      ]
        .filter(Boolean)
        .join(' · '),
      language,
      message: t('email.invite.message', params),
      preview: t('email.invite.preview', params),
      title: t('email.invite.title', params),
    }),
  );
  return {
    subject: t('email.invite.subject', params)
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}

/** To a private site's Admins: someone asked to read it. */
export async function renderReaderAccessRequestEmail({
  language = DEFAULT_EMAIL_LANGUAGE,
  note,
  projectName,
  requester,
  reviewUrl,
}: {
  language?: EmailLanguage;
  note?: string | null;
  projectName: string;
  requester: string;
  reviewUrl: string;
}) {
  const t = createEmailTranslator(language);
  const params = { projectName, requester };
  const message = t('email.accessRequest.message', params);
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      action: { label: t('email.accessRequest.action'), url: reviewUrl },
      detail: note ? t('email.accessRequest.note', { note }) : t('email.accessRequest.review'),
      language,
      message,
      preview: message,
      title: t('email.accessRequest.title', params),
    }),
  );
  return {
    subject: t('email.accessRequest.subject', params)
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
  const t = createEmailTranslator(language);
  const params = { days, projectName };
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      action: { label: t('email.readerInvite.action'), url: activationUrl },
      detail: `${t('email.readerInvite.expiry', params)} ${t('email.readerInvite.later')}`,
      language,
      message: t('email.readerInvite.message', params),
      preview: t('email.readerInvite.preview', params),
      title: t('email.readerInvite.title'),
    }),
  );
  return {
    subject: t('email.readerInvite.subject', params)
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}

/** A one-time code for signing in on a private published site. */
export async function renderSiteSignInCodeEmail({
  code,
  language = DEFAULT_EMAIL_LANGUAGE,
  projectName,
}: {
  code: string;
  language?: EmailLanguage;
  projectName: string;
}) {
  const t = createEmailTranslator(language);
  const params = { projectName };
  const message = t('email.siteSignIn.message', params);
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      code,
      detail: t('email.otp.expiry', { minutes: 10 }),
      language,
      message,
      preview: message,
      title: t('email.siteSignIn.title', params),
    }),
  );
  return {
    subject: t('email.siteSignIn.subject', params)
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
  const t = createEmailTranslator(language);
  const prefix = outcome === 'ready' ? 'deployment.ready' : 'deployment.failed';
  const params = { error: error ?? '', projectName, version };
  const { html, text } = await renderEmail(
    createElement(TransactionalEmail, {
      ...(outcome === 'ready' && siteUrl ? { action: { label: t('email.deployment.ready.action'), url: siteUrl } } : {}),
      ...(outcome === 'failed' && error ? { detail: t('email.deployment.failed.detail', params) } : {}),
      language,
      message: t(`email.${prefix}.message`, params),
      preview: t(`email.${prefix}.preview`, params),
      title: t(`email.${prefix}.title`, params),
    }),
  );
  return {
    subject: t(`email.${prefix}.subject`, params)
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    html,
    text,
  };
}
