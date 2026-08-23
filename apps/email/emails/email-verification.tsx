import { TransactionalEmail } from '@nibleaf/email';

export default function EmailVerificationEmail() {
  return (
    <TransactionalEmail
      action={{ label: 'Verify email', url: 'https://nibleaf.com/verify-email?token=preview-token' }}
      detail="This verification link is single-use. If it expires, request a new one from the sign-in page."
      language="en"
      message="Confirm this email address to finish setting up your Nibleaf account."
      preview="Confirm your email address to finish setting up Nibleaf."
      title="Verify your email address"
    />
  );
}
