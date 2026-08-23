import type { CSSProperties, ReactNode } from 'react';
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from 'react-email';
import { createEmailTranslator, type EmailLanguage } from '../i18n';

const colors = {
  background: '#f1f5f9',
  border: '#e2e8f0',
  brand: '#0f172a',
  footer: '#64748b',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
};

const bodyStyle: CSSProperties = {
  backgroundColor: colors.background,
  color: colors.brand,
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  margin: 0,
  padding: '24px 12px',
};

export function BaseEmail({ children, language, preview }: { children: ReactNode; language: EmailLanguage; preview: string }) {
  const { t } = createEmailTranslator(language);

  return (
    <Html dir={language === 'ar' ? 'rtl' : 'ltr'} lang={language}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={bodyStyle}>
        <Container
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: '16px',
            margin: '0 auto',
            maxWidth: '560px',
            overflow: 'hidden',
          }}
        >
          <Section style={{ padding: '24px 28px', textAlign: language === 'ar' ? 'right' : 'left' }}>
            <Text style={{ fontSize: '18px', fontWeight: 750, letterSpacing: '-0.02em', margin: 0 }}>{t('brand.name')}</Text>
          </Section>
          <Hr style={{ borderColor: colors.border, margin: 0 }} />
          {children}
          <Section style={{ backgroundColor: colors.surfaceMuted, padding: '18px 28px' }}>
            <Text style={{ color: colors.footer, fontSize: '12px', lineHeight: 1.55, margin: 0 }}>{t('brand.footer')}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
