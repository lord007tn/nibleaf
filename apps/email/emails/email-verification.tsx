import { createEmailTranslator, TransactionalEmail } from '@nibleaf/email';

export default function EmailVerificationEmail() {
  const t = createEmailTranslator('en');
  return (
    <TransactionalEmail
      action={{ label: t('email.verifyEmail.action'), url: 'https://nibleaf.com/verify-email?token=preview-token' }}
      detail={t('email.verifyEmail.detail')}
      language="en"
      message={t('email.verifyEmail.message')}
      preview={t('email.verifyEmail.preview')}
      title={t('email.verifyEmail.title')}
    />
  );
}
