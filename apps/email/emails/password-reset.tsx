import { PasswordResetEmailTemplate } from '@nibleaf/email';

const previewUrl = 'https://nibleaf.com/api/auth/reset-password/preview-token?callbackURL=https%3A%2F%2Fnibleaf.com%2Freset-password';

export default function PasswordResetEmail() {
  return <PasswordResetEmailTemplate url={previewUrl} />;
}
