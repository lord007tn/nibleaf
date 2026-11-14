import { useAuthT } from '@/lib/auth-messages';

/** Shown at each action that can create an account. */
export function TermsNotice() {
  const t = useAuthT();
  return (
    <p className="text-center text-muted-foreground text-xs leading-relaxed">
      {t('auth.legal.continuePrefix')}{' '}
      <a className="underline hover:text-primary" href="/terms" rel="noreferrer" target="_blank">
        {t('auth.legal.terms')}
      </a>
      {t('auth.legal.and')}
      <a className="underline hover:text-primary" href="/privacy" rel="noreferrer" target="_blank">
        {t('auth.legal.privacy')}
      </a>
      {t('auth.legal.agreeSuffix')}
    </p>
  );
}
