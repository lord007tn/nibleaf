import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GoogleIcon } from '@/components/icons/brand';
import { AuthLayout } from '@/layouts/auth';
import { authClient, signIn } from '@/lib/auth-client';
import { useT } from '@/lib/i18n';
import { readPendingInvitation } from '@/lib/invitations';

interface AuthSearch {
  invite?: string;
  email?: string;
}

export const Route = createFileRoute('/(auth)/sign-up')({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    invite: typeof search.invite === 'string' ? search.invite : undefined,
    email: typeof search.email === 'string' ? search.email : undefined,
  }),
  head: () => ({ meta: [{ title: 'Sign up — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: SignUpPage,
});

interface PublicMeta {
  providers: { google: boolean };
  signupDisabled: boolean;
}

function usePublicMeta() {
  const [meta, setMeta] = useState({ googleEnabled: false, signupDisabled: true });
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/public/meta')
      .then(async (response) => (response.ok ? ((await response.json()) as { data: PublicMeta }) : null))
      .then((result) => {
        if (!cancelled && result) setMeta({ googleEnabled: result.data.providers.google, signupDisabled: result.data.signupDisabled });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return meta;
}

function SignUpPage() {
  const t = useT();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const lockedEmail = Boolean(search.email);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(search.email ?? '');
  const [otp, setOtp] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { googleEnabled, signupDisabled } = usePublicMeta();

  const normalizedEmail = email.trim().toLowerCase();
  const invitationId = search.invite ?? readPendingInvitation() ?? undefined;
  const afterAuthPath = invitationId ? `/accept-invite/${invitationId}` : '/app';

  const finishSignUp = async () => {
    if (invitationId) {
      await navigate({ to: '/accept-invite/$invitationId', params: { invitationId } });
    } else {
      await navigate({ to: '/app' });
    }
  };

  const requestCode = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email: normalizedEmail, type: 'sign-in' });
      if (result.error) {
        setError(result.error.message ?? t('auth.otp.sendError'));
        return;
      }
      setCodeSent(true);
    } catch {
      setError(t('auth.otp.sendError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyCode = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await authClient.signIn.emailOtp({ email: normalizedEmail, otp: otp.trim(), name: name.trim() });
      if (result.error) {
        setError(result.error.message ?? t('auth.otp.invalid'));
        return;
      }
      await finishSignUp();
    } catch {
      setError(t('auth.otp.invalid'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const signUpWithGoogle = async () => {
    setError(null);
    setIsGoogleSubmitting(true);
    const result = await signIn.social({ provider: 'google', callbackURL: afterAuthPath });
    if (result.error) {
      setError(result.error.message ?? t('auth.signUp.error'));
      setIsGoogleSubmitting(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (codeSent) await verifyCode();
    else await requestCode();
  };

  if (signupDisabled) {
    return (
      <AuthLayout subtitle={t('auth.signUp.subtitle')}>
        <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-center text-muted-foreground text-sm">
          {t('auth.legal.signupDisabled')}
        </p>
        <p className="mt-5 text-center text-muted-foreground text-sm">
          {t('auth.signUp.haveAccount')}{' '}
          <Link className="text-primary hover:underline" to="/sign-in">
            {t('auth.signIn.submit')}
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle={codeSent ? t('auth.otp.checkEmail', { email: normalizedEmail }) : t('auth.signUp.subtitle')}>
      {!codeSent && googleEnabled ? (
        <>
          <Button
            className="mb-4 w-full gap-2"
            disabled={isGoogleSubmitting || lockedEmail || !agreedToTerms}
            onClick={signUpWithGoogle}
            type="button"
            variant="outline"
          >
            <GoogleIcon className="size-4" />
            {isGoogleSubmitting ? t('auth.google.submitting') : t('auth.google.continue')}
          </Button>
          <div className="mb-4 flex items-center gap-3 text-muted-foreground text-xs">
            <span className="h-px flex-1 bg-border" />
            <span>{t('auth.divider.or')}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {!codeSent ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">{t('auth.field.name')}</Label>
              <Input
                autoComplete="name"
                autoFocus
                id="name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Ada Lovelace"
                required
                value={name}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">{t('auth.field.email')}</Label>
              <Input
                autoComplete="email"
                id="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                readOnly={lockedEmail}
                required
                type="email"
                value={email}
              />
              {lockedEmail ? <p className="text-muted-foreground text-xs">{t('auth.invite.invitedAs', { email: search.email ?? '' })}</p> : null}
            </div>
            <label className="flex items-start gap-2.5 text-muted-foreground text-sm" htmlFor="agree-terms">
              <input
                checked={agreedToTerms}
                className="mt-0.5 size-4 shrink-0 accent-primary"
                id="agree-terms"
                onChange={(event) => setAgreedToTerms(event.target.checked)}
                required
                type="checkbox"
              />
              <span>
                {t('auth.legal.agreePrefix')}
                <a className="text-primary hover:underline" href="/terms" rel="noreferrer" target="_blank">
                  {t('auth.legal.terms')}
                </a>
                {t('auth.legal.and')}
                <a className="text-primary hover:underline" href="/privacy" rel="noreferrer" target="_blank">
                  {t('auth.legal.privacy')}
                </a>
                {t('auth.legal.agreeSuffix')}
              </span>
            </label>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="otp">{t('auth.otp.label')}</Label>
            <Input
              autoComplete="one-time-code"
              autoFocus
              id="otp"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
              pattern="[0-9]{6}"
              placeholder="000000"
              required
              value={otp}
            />
            <p className="text-muted-foreground text-xs">{t('auth.otp.hint')}</p>
          </div>
        )}
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">{error}</p> : null}
        <Button
          className="mt-1 w-full"
          disabled={isSubmitting || (codeSent ? otp.length !== 6 : !agreedToTerms || !name.trim() || !normalizedEmail)}
          type="submit"
        >
          {isSubmitting
            ? codeSent
              ? t('auth.otp.verifying')
              : t('auth.otp.sending')
            : codeSent
              ? t('auth.otp.verifyCreate')
              : t('auth.otp.sendCreate')}
        </Button>
        {codeSent ? (
          <div className="flex items-center justify-between">
            <Button
              onClick={() => {
                setCodeSent(false);
                setOtp('');
                setError(null);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <ArrowLeft className="size-4" /> {t('auth.otp.changeDetails')}
            </Button>
            <Button disabled={isSubmitting} onClick={requestCode} size="sm" type="button" variant="ghost">
              {t('auth.otp.resend')}
            </Button>
          </div>
        ) : null}
      </form>
      {!codeSent ? (
        <p className="mt-5 text-center text-muted-foreground text-sm">
          {t('auth.signUp.haveAccount')}{' '}
          <Link className="text-primary hover:underline" to="/sign-in">
            {t('auth.signIn.submit')}
          </Link>
        </p>
      ) : null}
    </AuthLayout>
  );
}
