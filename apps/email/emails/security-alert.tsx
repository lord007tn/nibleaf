import { TransactionalEmailTemplate } from '@nibleaf/email';

export default function SecurityAlertEmail() {
  return (
    <TransactionalEmailTemplate
      options={{
        subject: 'New sign-in to your Nibleaf account',
        preheader: 'We noticed a sign-in from a new device or location.',
        title: 'New sign-in detected',
        message: 'We noticed a new sign-in to your account from a new device.',
        detail: 'If this was not you, sign out other sessions immediately and contact support@nibleaf.com.',
      }}
    />
  );
}
