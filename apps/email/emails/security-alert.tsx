import { createEmailTranslator, TransactionalEmail } from '@nibleaf/email';

export default function SecurityAlertEmail() {
  const t = createEmailTranslator('en');
  return (
    <TransactionalEmail
      detail={t('email.newSignIn.detail')}
      language="en"
      message={t('email.newSignIn.withoutIp')}
      preview={t('email.newSignIn.preview')}
      title={t('email.newSignIn.title')}
    />
  );
}
