import { useAuthT } from '@/lib/auth-messages';

const LEGAL_LINK_CLASS =
  'rounded-sm underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2';

/**
 * The terms an account accepts. Sign-in and sign-up show it once, under the
 * heading (AuthLayout's `notice`), so it covers Google and the email code
 * alike; the code step shows it at its Verify button.
 */
export function TermsNotice({ className = 'text-center' }: { className?: string }) {
  const t = useAuthT();
  return (
    <p className={`text-muted-foreground text-xs leading-relaxed ${className}`} data-slot="terms-notice">
      {t('auth.legal.continuePrefix')}{' '}
      <a className={LEGAL_LINK_CLASS} href="/terms" rel="noreferrer" target="_blank">
        {t('auth.legal.terms')}
      </a>
      {t('auth.legal.and')}
      <a className={LEGAL_LINK_CLASS} href="/privacy" rel="noreferrer" target="_blank">
        {t('auth.legal.privacy')}
      </a>
      {t('auth.legal.agreeSuffix')}
    </p>
  );
}
