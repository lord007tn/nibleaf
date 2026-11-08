import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@nibleaf/design-system/components/ui/input-otp';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { Mail } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { AuthLayout } from '@/layouts/auth';
import { friendlyAuthError } from '@/lib/auth-errors';
import { afterAuthDestination } from '@/lib/invitations';
import { authClient, useSession } from '@/services/auth-client';

export const Route = createFileRoute('/(auth)/verify-email')({
  component: VerifyEmailPage,
  validateSearch: (search) =>
    z
      .object({
        email: z.string().optional().catch(undefined),
        token: z.string().optional().catch(undefined),
        invite: z.string().optional().catch(undefined),
        // The dashboard page that sent a signed-out visitor here (checked by afterAuthDestination).
        next: z.string().optional().catch(undefined),
        delivery: z.enum(['sent', 'failed']).optional().catch(undefined),
      })
      .parse(search),
});

function VerifyEmailPage() {
  const t = useT();
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const { data: session } = useSession();
  // With no address in the link or the session, the visitor types one to get a code.
  const [typedEmail, setTypedEmail] = useState('');
  const [codeEmail, setCodeEmail] = useState('');
  const email = search.email || session?.user?.email || codeEmail;
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(search.delivery === 'failed' ? t('auth.verify.sendError') : null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(Boolean(search.token));
  const [verified, setVerified] = useState(false);
  // An old link that failed: the page goes on with a code instead of waiting on the dead link.
  const [linkFailed, setLinkFailed] = useState(false);
  const [linkNotice, setLinkNotice] = useState(false);
  const checkingLink = Boolean(search.token) && !linkFailed;
  const shownError = error ?? (linkNotice ? t(email ? 'auth.verify.invalidLinkResend' : 'auth.verify.invalidLinkEnterEmail') : null);

  const continueAfterVerification = useCallback(() => {
    const destination = afterAuthDestination({ invite: search.invite, next: search.next });
    if (destination) router.history.push(destination);
    else navigate({ to: '/app' });
  }, [navigate, router, search.invite, search.next]);

  // Keep old link-based verification emails valid while new signups use OTP.
  useEffect(() => {
    if (!search.token) {
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await authClient.verifyEmail({ query: { token: search.token ?? '' } });
      if (cancelled) {
        return;
      }
      if (result.error) {
        setLinkFailed(true);
        setLinkNotice(true);
        setVerifying(false);
        return;
      }
      setVerified(true);
      toast.success(t('auth.verify.verifiedToast'));
      continueAfterVerification();
    })();
    return () => {
      cancelled = true;
    };
  }, [search.token, t, continueAfterVerification]);

  const resend = async () => {
    const target = email || typedEmail.trim().toLowerCase();
    if (!target) {
      setError(t('auth.verify.noEmail'));
      return;
    }
    setError(null);
    setSending(true);
    const result = await authClient.emailOtp.sendVerificationOtp({ email: target, type: 'email-verification' });
    setSending(false);
    if (result.error) {
      setError(t('auth.verify.sendError'));
      return;
    }
    setOtp('');
    setLinkNotice(false);
    setCodeEmail(target);
    toast.success(t('auth.verify.sentToast', { email: target }));
  };

  const verifyCode = async () => {
    if (!email || otp.length !== 6) {
      setError(t('auth.verify.invalidCode'));
      return;
    }
    setError(null);
    setLinkNotice(false);
    setVerifying(true);
    const result = await authClient.emailOtp.verifyEmail({ email, otp });
    if (result.error) {
      setError(friendlyAuthError(result.error, t, t('auth.verify.invalidCode')));
      setVerifying(false);
      return;
    }
    setVerified(true);
    toast.success(t('auth.verify.verifiedToast'));
    continueAfterVerification();
  };

  const errorAlert = shownError ? (
    <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm" role="alert">
      {shownError}
    </p>
  ) : null;

  return (
    <AuthLayout subtitle={t('auth.verify.subtitle')}>
      <div className="text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
          <Mail className="size-6" />
        </div>
        {/* The layout's subtitle is the page h1; this is its heading level below. */}
        <h2 className="font-semibold text-2xl tracking-tight">{t('auth.verify.title')}</h2>
        <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
          {checkingLink ? (
            t('auth.verify.verifying')
          ) : verified ? (
            t('auth.verify.verified')
          ) : email ? (
            <>
              {t('auth.verify.sentTo')} <span className="font-medium text-foreground">{email}</span>
            </>
          ) : (
            t('auth.verify.enterEmail')
          )}
        </p>
      </div>

      {checkingLink || verified ? null : email ? (
        <>
          <form
            className="mt-6 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void verifyCode();
            }}
          >
            <div className="flex flex-col items-center gap-2" dir="ltr">
              <Label htmlFor="verification-code">{t('auth.verify.codeLabel')}</Label>
              <InputOTP
                aria-invalid={Boolean(shownError)}
                autoComplete="one-time-code"
                autoFocus
                containerClassName="justify-center"
                disabled={verifying}
                id="verification-code"
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
            </div>
            {errorAlert}
            <Button className="w-full" disabled={otp.length !== 6} loading={verifying} loadingText={t('auth.verify.submitting')} type="submit">
              {t('auth.verify.submit')}
            </Button>
          </form>
          <Button
            className="mt-3 w-full"
            disabled={verifying}
            loading={sending}
            loadingText={t('auth.verify.resending')}
            onClick={resend}
            type="button"
            variant="outline"
          >
            {t('auth.verify.resend')}
          </Button>
        </>
      ) : (
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void resend();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="verification-email">{t('auth.field.email')}</Label>
            <Input
              autoComplete="email"
              autoFocus
              id="verification-email"
              onChange={(event) => setTypedEmail(event.target.value)}
              placeholder="you@company.com"
              required
              type="email"
              value={typedEmail}
            />
          </div>
          {errorAlert}
          <Button className="w-full" disabled={!typedEmail.trim()} loading={sending} loadingText={t('auth.verify.resending')} type="submit">
            {t('auth.verify.sendCode')}
          </Button>
        </form>
      )}

      <div className="mt-5 text-center text-muted-foreground text-sm">
        <Link
          className="hover:text-primary hover:underline"
          search={{ email: email || undefined, invite: search.invite, next: search.next }}
          to="/sign-in"
        >
          {t('auth.backToSignIn')}
        </Link>
      </div>
    </AuthLayout>
  );
}
