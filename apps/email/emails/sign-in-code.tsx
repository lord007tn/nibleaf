import { TransactionalEmail } from '@nibleaf/email';

export default function SignInCodeEmail() {
  return (
    <TransactionalEmail
      code="123456"
      detail="The code expires in 10 minutes and can be used only once."
      language="en"
      message="Use this one-time code to sign in."
      preview="Use this one-time code to sign in."
      title="Your Nibleaf code"
    />
  );
}
