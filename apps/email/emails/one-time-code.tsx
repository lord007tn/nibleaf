import { TransactionalEmailTemplate } from '@nibleaf/email';

export default function OneTimeCodeEmail() {
  return (
    <TransactionalEmailTemplate
      options={{
        subject: 'Your Nibleaf sign-in code',
        preheader: 'Use this one-time code to sign in.',
        title: 'Your Nibleaf code',
        message: 'Use this one-time code to sign in.',
        code: '123456',
        detail: 'The code expires in 10 minutes and can be used only once.',
      }}
    />
  );
}
