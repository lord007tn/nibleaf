import { createEmailTranslator, TransactionalEmail } from '@nibleaf/email';

export default function SignInCodeEmail() {
  const t = createEmailTranslator('en');
  return (
    <TransactionalEmail
      code="123456"
      detail={t('email.otp.expiry', { minutes: 10 })}
      language="en"
      message={t('email.otp.signIn.message')}
      preview={t('email.otp.signIn.preview')}
      title={t('email.otp.title')}
    />
  );
}
