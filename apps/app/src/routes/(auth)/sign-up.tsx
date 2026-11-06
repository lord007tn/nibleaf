import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@nibleaf/design-system/components/ui/input-otp';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useOtpResendCountdown } from '@nibleaf/design-system/hooks/use-otp-resend-countdown';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { GoogleIcon } from '@/components/icons/brand';
import { QueryErrorState } from '@/components/query-error-state';
import { useGetPublicMeta } from '@/hooks/api/public';
import { AuthLayout } from '@/layouts/auth';
import { friendlyAuthError } from '@/lib/auth-errors';
import { readPendingInvitation } from '@/lib/invitations';
import { authClient, signIn } from '@/services/auth-client';

export const Route = createFileRoute('/(auth)/sign-up')({
  validateSearch: (search) =>
    z
      .object({
        invite: z.string().optional().catch(undefined),
        email: z.string().optional().catch(undefined),
        intent: z.literal('first-publish').optional().catch(undefined),
      })
      .parse(search),
  head: () => ({ meta: [{ title: 'Sign up — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: SignUpPage,
});

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
  // Buttons stay enabled; pressing one without the terms ticked says why instead.
  const [termsError, setTermsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { resendIn, resetCountdown, startCountdown } = useOtpResendCountdown();
  const { data: publicMeta, isPending: metaPending, isError: metaError, isFetching: metaFetching, refetch: retryMeta } = useGetPublicMeta();
  const googleEnabled = publicMeta?.providers.google ?? false;
  const signupDisabled = publicMeta?.signupDisabled ?? true;

  const normalizedEmail = email.trim().toLowerCase();
  const invitationId = search.invite ?? readPendingInvitation() ?? undefined;
  const firstPublish = search.intent === 'first-publish';
  const afterAuthPath = invitationId ? `/accept-invite/${invitationId}` : firstPublish ? '/app?firstPublish=true' : '/app';

  const finishSignUp = async () => {
    if (invitationId) {
      await navigate({ to: '/accept-invite/$invitationId', params: { invitationId } });
    } else {
      await navigate({ to: '/app', search: firstPublish ? { firstPublish: true } : {} });
    }
  };

  const requestCode = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email: normalizedEmail, type: 'sign-in' });
      if (result.error) {
        setError(friendlyAuthError(result.error, t, t('auth.otp.sendError')));
        return;
      }
      setCodeSent(true);
      startCountdown();
    } catch {
      setError(t('auth.error.tryAgain'));
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
        setError(friendlyAuthError(result.error, t, t('auth.otp.invalid')));
        return;
      }
      await finishSignUp();
    } catch {
      setError(t('auth.error.tryAgain'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const signUpWithGoogle = async () => {
    setError(null);
    setIsGoogleSubmitting(true);
    const result = await signIn.social({ provider: 'google', callbackURL: afterAuthPath });
    if (result.error) {
      setError(friendlyAuthError(result.error, t, t('auth.signUp.error')));
      setIsGoogleSubmitting(false);
    }
  };

  const requireTerms = () => {
    if (agreedToTerms) return true;
    setTermsError(true);
    document.getElementById('agree-terms')?.focus();
    return false;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (codeSent) {
      await verifyCode();
    } else if (requireTerms()) {
      await requestCode();
    }
  };

  if (metaPending) {
    return (
      <AuthLayout subtitle={t('auth.signUp.subtitle')}>
        <p className="py-4 text-center text-muted-foreground text-sm" role="status">
          {t('common.loading')}
        </p>
      </AuthLayout>
    );
  }

  if (metaError || !publicMeta) {
    return (
      <AuthLayout subtitle={t('auth.signUp.subtitle')}>
        <QueryErrorState onRetry={() => void retryMeta()} retrying={metaFetching} />
      </AuthLayout>
    );
  }

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
      {/* An invitation is tied to one address, so Google (which may pick another) is hidden. */}
      {!codeSent && googleEnabled && !lockedEmail ? (
        <>
          <Button
            className="mb-4 w-full gap-2"
            disabled={isGoogleSubmitting}
            onClick={() => {
              if (requireTerms()) void signUpWithGoogle();
            }}
            type="button"
            variant="outline"
          >
            <GoogleIcon className="size-4" />
            {isGoogleSubmitting ? t('auth.google.submitting') : t('auth.google.signUp')}
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
                aria-describedby={termsError ? 'agree-terms-error' : undefined}
                aria-invalid={termsError || undefined}
                checked={agreedToTerms}
                className="mt-0.5 size-4 shrink-0 accent-primary"
                id="agree-terms"
                onChange={(event) => {
                  setAgreedToTerms(event.target.checked);
                  if (event.target.checked) setTermsError(false);
                }}
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
            {termsError ? (
              <p className="-mt-2 text-destructive text-sm" id="agree-terms-error" role="alert">
                {t('auth.legal.agreeFirst')}
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2" dir="ltr">
            <Label htmlFor="otp">{t('auth.otp.label')}</Label>
            <InputOTP
              aria-invalid={Boolean(error)}
              autoComplete="one-time-code"
              autoFocus
              containerClassName="justify-center"
              disabled={isSubmitting}
              id="otp"
              inputMode="numeric"
              maxLength={6}
              onChange={setOtp}
              onComplete={verifyCode}
              value={otp}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
            <p className="text-center text-muted-foreground text-xs">{t('auth.otp.hint')}</p>
          </div>
        )}
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <Button className="mt-1 w-full" disabled={isSubmitting || (codeSent && otp.length !== 6)} type="submit">
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
                resetCountdown();
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t('auth.otp.changeDetails')}
            </Button>
            <Button disabled={isSubmitting || resendIn > 0} onClick={requestCode} size="sm" type="button" variant="ghost">
              {resendIn > 0 ? t('auth.otp.resendIn', { seconds: resendIn }) : t('auth.otp.resend')}
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
