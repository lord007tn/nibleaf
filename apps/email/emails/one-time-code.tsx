import { createEmailTranslator, TransactionalEmail } from '@nibleaf/email';

export default function OneTimeCodeEmail() {
  const t = createEmailTranslator('ar');
  return (
    <TransactionalEmail
      code="123456"
      detail={t('email.otp.expiry', { minutes: 10 })}
      language="ar"
      message={t('email.otp.signIn.message')}
      preview={t('email.otp.signIn.preview')}
      title={t('email.otp.title')}
    />
  );
}
