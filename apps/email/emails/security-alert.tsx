import { TransactionalEmail } from '@nibleaf/email';

export default function SecurityAlertEmail() {
  return (
    <TransactionalEmail
      detail="If this was not you, sign out other sessions immediately and contact support@nibleaf.com."
      language="en"
      message="We noticed a new sign-in to your account from a new device."
      preview="We noticed a sign-in from a new device or location."
      title="New sign-in detected"
    />
  );
}
