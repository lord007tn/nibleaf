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

type TransactionalEmailRenderer = (element: React.ReactElement) => Promise<string>;

const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/**
 * Keep auth email delivery available if the optional React Email renderer
 * rejects inside a long-running request context. All dynamic values are
 * escaped before they are inserted into the fallback markup.
 */
function fallbackTransactionalEmailHtml(options: TransactionalEmailOptions): string {
  const preheader = escapeHtml(options.preheader);
  const title = escapeHtml(options.title);
  const message = escapeHtml(options.message);
  const code = options.code ? escapeHtml(options.code) : undefined;
  const action = options.action ? { label: escapeHtml(options.action.label), url: escapeHtml(options.action.url) } : undefined;
  const detail = options.detail ? escapeHtml(options.detail) : undefined;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="background:#f1f5f9;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:24px 12px">
  <div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheader}</div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;margin:0 auto;max-width:560px;overflow:hidden">
    <div style="padding:24px 28px;font-size:18px;font-weight:700;letter-spacing:-.02em">Nibleaf</div>
    <div style="border-top:1px solid #e2e8f0;padding:32px 28px">
      <h1 style="font-size:24px;letter-spacing:-.025em;line-height:1.25;margin:0 0 14px">${title}</h1>
      <p style="color:#475569;font-size:15px;line-height:1.65;margin:0">${message}</p>
      ${code ? `<div style="background:#f1f5f9;border-radius:10px;display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;font-weight:700;letter-spacing:.22em;line-height:1;margin:24px 0 0;padding:14px 20px">${code}</div>` : ''}
      ${action ? `<div style="margin-top:24px"><a href="${action.url}" style="background:#0f172a;border-radius:10px;color:#fff;display:inline-block;font-size:14px;font-weight:700;padding:12px 18px;text-decoration:none">${action.label}</a></div><p style="color:#64748b;font-size:12px;line-height:1.55;margin:18px 0 0">If the button does not work, copy and paste this link:<br><a href="${action.url}" style="color:#0f766e;word-break:break-all">${action.url}</a></p>` : ''}
      ${detail ? `<p style="color:#64748b;font-size:13px;line-height:1.6;margin:22px 0 0">${detail}</p>` : ''}
    </div>
    <div style="background:#f8fafc;color:#94a3b8;font-size:12px;line-height:1.55;padding:18px 28px">This automated message was sent by Nibleaf. If you did not request it, you can safely ignore it.</div>
  </div>
</body></html>`;
}

/** Build a responsive React Email template with an explicit plain-text fallback. */
export async function buildTransactionalEmail(
  options: TransactionalEmailOptions,
  renderEmail: TransactionalEmailRenderer = render,
): Promise<TransactionalEmail> {
  const subject = options.subject.replace(/[\r\n]+/g, ' ').trim();
  let html: string;
  try {
    html = await renderEmail(<TransactionalEmailTemplate options={options} />);
  } catch {
    html = fallbackTransactionalEmailHtml(options);
  }
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
