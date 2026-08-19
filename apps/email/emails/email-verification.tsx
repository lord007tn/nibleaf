import { TransactionalEmailTemplate } from '@nibleaf/email';

export default function EmailVerificationEmail() {
  return (
    <TransactionalEmailTemplate
      options={{
        subject: 'Verify your Nibleaf email',
        preheader: 'Confirm your email address to finish setting up Nibleaf.',
        title: 'Verify your email address',
        message: 'Confirm this email address to finish setting up your Nibleaf account.',
        action: { label: 'Verify email', url: 'https://nibleaf.com/verify-email?token=preview-token' },
        detail: 'This verification link is single-use. If it expires, request a new one from the sign-in page.',
      }}
    />
  );
}
