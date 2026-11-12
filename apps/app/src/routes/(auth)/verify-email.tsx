import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { Mail } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { AuthCodeField } from '@/components/auth-email-code';
import { AuthLayout } from '@/layouts/auth';
import { friendlyAuthError, isCodeLockedError } from '@/lib/auth-errors';
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
  // Three wrong guesses spend a code: only "Resend code" helps then.
  const [needsNewCode, setNeedsNewCode] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);
  // Focus after the render that re-enables the input; a disabled input can't take focus.
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest) codeInput.current?.focus();
  }, [focusRequest]);
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
    setNeedsNewCode(false);
    setLinkNotice(false);
    setCodeEmail(target);
    setFocusRequest((count) => count + 1);
    toast.success(t('auth.verify.sentToast', { email: target }));
  };

  const verifyCode = async (code = otp) => {
    if (!email || code.length !== 6) {
      setError(t('auth.verify.invalidCode'));
      return;
    }
    setError(null);
    setLinkNotice(false);
    setVerifying(true);
    const result = await authClient.emailOtp.verifyEmail({ email, otp: code });
    if (result.error) {
      setError(friendlyAuthError(result.error, t, t('auth.verify.invalidCode')));
      setVerifying(false);
      // A rejected code is no use in the boxes; a server failure keeps it for another try.
      if ((result.error.status ?? 400) < 500) setOtp('');
      if (isCodeLockedError(result.error)) setNeedsNewCode(true);
      else setFocusRequest((count) => count + 1);
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
              {t('auth.verify.sentTo')}
              {/* On its own line, left-to-right and whole; broken only when it can't fit. */}
              <span className="block font-medium text-foreground">
                <span className="[overflow-wrap:anywhere] [unicode-bidi:isolate]" dir="ltr">
                  {email}
                </span>
              </span>
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
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void verifyCode();
            }}
          >
            <AuthCodeField
              disabled={verifying || needsNewCode}
              error={shownError}
              id="verification-code"
              inputRef={codeInput}
              label={t('auth.verify.codeLabel')}
              onChange={setOtp}
              onComplete={(code) => void verifyCode(code)}
              value={otp}
            />
            {needsNewCode ? null : (
              <Button className="w-full" disabled={verifying} loading={verifying} loadingText={t('auth.verify.submitting')} type="submit">
                {t('auth.verify.submit')}
              </Button>
            )}
          </form>
          <Button
            className="mt-3 w-full"
            disabled={verifying}
            loading={sending}
            loadingText={t('auth.verify.resending')}
            onClick={resend}
            type="button"
            variant={needsNewCode ? 'default' : 'outline'}
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
              className="text-start"
              dir="ltr"
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
