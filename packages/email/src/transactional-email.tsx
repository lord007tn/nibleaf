import type { CSSProperties } from 'react';
import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, render, Section, Text } from 'react-email';

export interface TransactionalEmail {
  subject: string;
  html: string;
  text: string;
}

export interface TransactionalEmailOptions {
  subject: string;
  preheader: string;
  title: string;
  message: string;
  action?: {
    label: string;
    url: string;
  };
  code?: string;
  detail?: string;
}

export const passwordResetEmailOptions = (url: string): TransactionalEmailOptions => ({
  subject: 'Reset your Nibleaf password',
  preheader: 'Choose a new password for your Nibleaf account.',
  title: 'Reset your password',
  message: 'A password reset was requested for your Nibleaf account. Use the secure button below to choose a new password.',
  action: { label: 'Choose a new password', url },
  detail: 'This single-use link expires in one hour. If you did not request it, no action is required.',
});

const colors = {
  background: '#f1f5f9',
  border: '#e2e8f0',
  brand: '#0f172a',
  detail: '#64748b',
  footer: '#94a3b8',
  link: '#0f766e',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  text: '#475569',
};

const bodyStyle: CSSProperties = {
  backgroundColor: colors.background,
  color: colors.brand,
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  margin: 0,
  padding: '24px 12px',
};

const containerStyle: CSSProperties = {
  backgroundColor: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: '16px',
  margin: '0 auto',
  maxWidth: '560px',
  overflow: 'hidden',
};

export function TransactionalEmailTemplate({ options }: { options: TransactionalEmailOptions }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{options.preheader}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={{ padding: '24px 28px' }}>
            <Text style={{ fontSize: '18px', fontWeight: 750, letterSpacing: '-0.02em', margin: 0 }}>Nibleaf</Text>
          </Section>
          <Hr style={{ borderColor: colors.border, margin: 0 }} />
          <Section style={{ padding: '32px 28px' }}>
            <Heading style={{ fontSize: '24px', letterSpacing: '-0.025em', lineHeight: 1.25, margin: '0 0 14px' }}>{options.title}</Heading>
            <Text style={{ color: colors.text, fontSize: '15px', lineHeight: 1.65, margin: 0 }}>{options.message}</Text>
            {options.code ? (
              <Text
                style={{
                  backgroundColor: colors.background,
                  borderRadius: '10px',
                  color: colors.brand,
                  display: 'inline-block',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '28px',
                  fontWeight: 700,
                  letterSpacing: '0.22em',
                  lineHeight: 1,
                  margin: '24px 0 0',
                  padding: '14px 20px',
                }}
              >
                {options.code}
              </Text>
            ) : null}
            {options.action ? (
              <>
                <Button
                  href={options.action.url}
                  style={{
                    backgroundColor: colors.brand,
                    borderRadius: '10px',
                    color: colors.surface,
                    display: 'inline-block',
                    fontSize: '14px',
                    fontWeight: 700,
                    marginTop: '24px',
                    padding: '12px 18px',
                    textDecoration: 'none',
                  }}
                >
                  {options.action.label}
                </Button>
                <Text style={{ color: colors.detail, fontSize: '12px', lineHeight: 1.55, margin: '18px 0 0' }}>
                  If the button does not work, copy and paste this link:
                  <br />
                  <Link href={options.action.url} style={{ color: colors.link, wordBreak: 'break-all' }}>
                    {options.action.url}
                  </Link>
                </Text>
              </>
            ) : null}
            {options.detail ? (
              <Text style={{ color: colors.detail, fontSize: '13px', lineHeight: 1.6, margin: '22px 0 0' }}>{options.detail}</Text>
            ) : null}
          </Section>
          <Section style={{ backgroundColor: colors.surfaceMuted, padding: '18px 28px' }}>
            <Text style={{ color: colors.footer, fontSize: '12px', lineHeight: 1.55, margin: 0 }}>
              This automated message was sent by Nibleaf. If you did not request it, you can safely ignore it.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function PasswordResetEmailTemplate({ url }: { url: string }) {
  return <TransactionalEmailTemplate options={passwordResetEmailOptions(url)} />;
}

export function buildPasswordResetEmail(url: string): Promise<TransactionalEmail> {
  return buildTransactionalEmail(passwordResetEmailOptions(url));
}

/** Build a responsive React Email template with an explicit plain-text fallback. */
export async function buildTransactionalEmail(options: TransactionalEmailOptions): Promise<TransactionalEmail> {
  const subject = options.subject.replace(/[\r\n]+/g, ' ').trim();
  const html = await render(<TransactionalEmailTemplate options={options} />);
  const text = [
    `Nibleaf — ${options.title}`,
    '',
    options.message,
    ...(options.code ? ['', `Code: ${options.code}`] : []),
    ...(options.action ? ['', `${options.action.label}: ${options.action.url}`] : []),
    ...(options.detail ? ['', options.detail] : []),
    '',
    'If you did not request this message, you can safely ignore it.',
  ].join('\n');

  return { subject, html, text };
}
