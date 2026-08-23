import { TransactionalEmail } from '@nibleaf/email';

export default function OneTimeCodeEmail() {
  return (
    <TransactionalEmail
      code="123456"
      detail="تنتهي صلاحية الرمز خلال 10 دقائق، ولا يمكن استخدامه إلا مرة واحدة."
      language="ar"
      message="استخدم هذا الرمز لمرة واحدة لتسجيل الدخول."
      preview="استخدم هذا الرمز لمرة واحدة لتسجيل الدخول."
      title="رمز نيبليف الخاص بك"
    />
  );
}
