import React from 'react';
import { Button, Heading, Link, Section, Text } from 'react-email';
import { createEmailTranslator, type EmailLanguage, emailDirection } from '../translate';
import { BaseEmail } from './base';

export function TransactionalEmail({
  action,
  code,
  detail,
  language,
  message,
  preview,
  title,
}: {
  action?: { label: string; url: string };
  code?: string;
  detail?: string;
  language: EmailLanguage;
  message: string;
  preview: string;
  title: string;
}) {
  const t = createEmailTranslator(language);
  const direction = emailDirection(language);

  return (
    <BaseEmail language={language} preview={preview}>
      <Section style={{ padding: '32px 28px', textAlign: direction === 'rtl' ? 'right' : 'left' }}>
        <Heading style={{ fontSize: '24px', letterSpacing: '-0.025em', lineHeight: 1.25, margin: '0 0 14px' }}>{title}</Heading>
        <Text style={{ color: '#475569', fontSize: '15px', lineHeight: 1.65, margin: 0 }}>{message}</Text>
        {code ? (
          <Text
            dir="ltr"
            style={{
              backgroundColor: '#f1f5f9',
              borderRadius: '10px',
              color: '#0f172a',
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
            {code}
          </Text>
        ) : null}
        {action ? (
          <>
            <Button
              href={action.url}
              style={{
                backgroundColor: '#0f172a',
                borderRadius: '10px',
                color: '#ffffff',
                display: 'inline-block',
                fontSize: '14px',
                fontWeight: 700,
                marginTop: '24px',
                padding: '12px 18px',
                textDecoration: 'none',
              }}
            >
              {action.label}
            </Button>
            <Text style={{ color: '#64748b', fontSize: '12px', lineHeight: 1.55, margin: '18px 0 0' }}>
              {t('email.brand.fallbackLink')}
              <br />
              <Link dir="ltr" href={action.url} style={{ color: '#0f766e', wordBreak: 'break-all' }}>
                {action.url}
              </Link>
            </Text>
          </>
        ) : null}
        {detail ? <Text style={{ color: '#64748b', fontSize: '13px', lineHeight: 1.6, margin: '22px 0 0' }}>{detail}</Text> : null}
      </Section>
    </BaseEmail>
  );
}
