import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useOtpResendCountdown } from '@nibleaf/design-system/hooks/use-otp-resend-countdown';
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

export const Route = createFileRoute('/(auth)/sign-in')({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    invite: typeof search.invite === 'string' ? search.invite : undefined,
    email: typeof search.email === 'string' ? search.email : undefined,
  }),
  head: () => ({ meta: [{ title: 'Sign in — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: SignInPage,
});

interface PublicMeta {
  providers: { google: boolean };
}

function useGoogleEnabled() {
  const [googleEnabled, setGoogleEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/public/meta')
      .then(async (response) => (response.ok ? ((await response.json()) as { data: PublicMeta }) : null))
      .then((result) => {
        if (!cancelled && result) setGoogleEnabled(result.data.providers.google);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return googleEnabled;
}

function SignInPage() {
  const t = useT();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [email, setEmail] = useState(search.email ?? '');
  const [otp, setOtp] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { resendIn, resetCountdown, startCountdown } = useOtpResendCountdown();
  const googleEnabled = useGoogleEnabled();

  const normalizedEmail = email.trim().toLowerCase();
  const invitationId = search.invite ?? readPendingInvitation() ?? undefined;
  const afterAuthPath = invitationId ? `/accept-invite/${invitationId}` : '/app';

  const finishSignIn = async () => {
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
      startCountdown();
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
      const result = await authClient.signIn.emailOtp({ email: normalizedEmail, otp: otp.trim() });
      if (result.error) {
        setError(result.error.message ?? t('auth.otp.invalid'));
        return;
      }
      await finishSignIn();
    } catch {
      setError(t('auth.otp.invalid'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const signInWithGoogle = async () => {
    setError(null);
    setIsGoogleSubmitting(true);
    const result = await signIn.social({ provider: 'google', callbackURL: afterAuthPath });
    if (result.error) {
      setError(result.error.message ?? t('auth.signIn.error'));
      setIsGoogleSubmitting(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (codeSent) await verifyCode();
    else await requestCode();
  };

  return (
    <AuthLayout subtitle={codeSent ? t('auth.otp.checkEmail', { email: normalizedEmail }) : t('auth.signIn.subtitle')}>
      {!codeSent && googleEnabled ? (
        <>
          <Button className="mb-4 w-full gap-2" disabled={isGoogleSubmitting} onClick={signInWithGoogle} type="button" variant="outline">
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">{t('auth.field.email')}</Label>
            <Input
              autoComplete="email"
              autoFocus
              id="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
              type="email"
              value={email}
            />
          </div>
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
        <Button className="mt-1 w-full" disabled={isSubmitting || (codeSent ? otp.length !== 6 : !normalizedEmail)} type="submit">
          {isSubmitting
            ? codeSent
              ? t('auth.otp.verifying')
              : t('auth.otp.sending')
            : codeSent
              ? t('auth.otp.verifySignIn')
              : t('auth.otp.sendSignIn')}
        </Button>
        {codeSent ? (
          <div className="flex items-center justify-between">
            <Button
              onClick={() => {
                setCodeSent(false);
                setOtp('');
                setError(null);
                resetCountdown();
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <ArrowLeft className="size-4" /> {t('auth.otp.differentEmail')}
            </Button>
            <Button disabled={isSubmitting || resendIn > 0} onClick={requestCode} size="sm" type="button" variant="ghost">
              {resendIn > 0 ? t('auth.otp.resendIn', { seconds: resendIn }) : t('auth.otp.resend')}
            </Button>
          </div>
        ) : null}
      </form>
      {!codeSent ? (
        <>
          <p className="mt-4 text-center text-muted-foreground text-xs leading-relaxed">
            {t('auth.legal.socialNoticePrefix')}
            <Link className="underline hover:text-primary" to="/terms">
              {t('auth.legal.terms')}
            </Link>
            {t('auth.legal.and')}
            <Link className="underline hover:text-primary" to="/privacy">
              {t('auth.legal.privacy')}
            </Link>
            {t('auth.legal.agreeSuffix')}
          </p>
          <p className="mt-5 text-center text-muted-foreground text-sm">
            {t('auth.signIn.noAccount')}{' '}
            <Link className="text-primary hover:underline" to="/sign-up">
              {t('auth.signIn.createOne')}
            </Link>
          </p>
        </>
      ) : null}
    </AuthLayout>
  );
}
