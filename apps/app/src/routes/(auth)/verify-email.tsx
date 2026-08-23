import { Button } from '@nibleaf/design-system/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@nibleaf/design-system/components/ui/input-otp';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Mail } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AuthLayout } from '@/layouts/auth';
import { readPendingInvitation } from '@/lib/invitations';
import { authClient, useSession } from '@/services/auth-client';

interface VerifyEmailSearch {
  email?: string;
  token?: string;
  invite?: string;
  delivery?: 'sent' | 'failed';
}

export const Route = createFileRoute('/(auth)/verify-email')({
  component: VerifyEmailPage,
  validateSearch: (search: Record<string, unknown>): VerifyEmailSearch => ({
    email: typeof search.email === 'string' ? search.email : undefined,
    token: typeof search.token === 'string' ? search.token : undefined,
    invite: typeof search.invite === 'string' ? search.invite : undefined,
    delivery: search.delivery === 'sent' || search.delivery === 'failed' ? search.delivery : undefined,
  }),
});

function VerifyEmailPage() {
  const t = useT();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { data: session } = useSession();
  const email = search.email || session?.user?.email || '';
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(search.delivery === 'failed' ? t('auth.verify.sendError') : null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(Boolean(search.token));
  const [verified, setVerified] = useState(false);

  const continueAfterVerification = useCallback(() => {
    const inviteId = search.invite ?? readPendingInvitation() ?? undefined;
    if (inviteId) {
      navigate({ to: '/accept-invite/$invitationId', params: { invitationId: inviteId } });
      return;
    }
    navigate({ to: '/app' });
  }, [navigate, search.invite]);

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
        setError(t('auth.verify.invalidLink'));
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
    if (!email) {
      setError(t('auth.verify.noEmail'));
      return;
    }
    setError(null);
    setSending(true);
    const result = await authClient.emailOtp.sendVerificationOtp({ email, type: 'email-verification' });
    setSending(false);
    if (result.error) {
      setError(t('auth.verify.sendError'));
      return;
    }
    setOtp('');
    toast.success(t('auth.verify.sentToast', { email }));
  };

  const verifyCode = async () => {
    if (!email || otp.length !== 6) {
      setError(t('auth.verify.invalidCode'));
      return;
    }
    setError(null);
    setVerifying(true);
    const result = await authClient.emailOtp.verifyEmail({ email, otp });
    if (result.error) {
      setError(result.error.message ?? t('auth.verify.invalidCode'));
      setVerifying(false);
      return;
    }
    setVerified(true);
    toast.success(t('auth.verify.verifiedToast'));
    continueAfterVerification();
  };

  return (
    <AuthLayout subtitle={t('auth.verify.subtitle')}>
      <div className="text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
          <Mail className="size-6" />
        </div>
        <h1 className="font-semibold text-2xl tracking-tight">{t('auth.verify.title')}</h1>
        <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
          {verifying ? (
            t('auth.verify.verifying')
          ) : verified ? (
            t('auth.verify.verified')
          ) : email ? (
            <>
              {t('auth.verify.sentTo')} <span className="font-medium text-foreground">{email}</span>
            </>
          ) : (
            t('auth.verify.sentGeneric')
          )}
        </p>
      </div>

      {email && !search.token ? (
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
              aria-invalid={Boolean(error)}
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
          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">{error}</p> : null}
          <Button className="w-full" disabled={verifying || otp.length !== 6} type="submit">
            {verifying ? t('auth.verify.submitting') : t('auth.verify.submit')}
          </Button>
        </form>
      ) : error ? (
        <p className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">{error}</p>
      ) : null}

      <Button className="mt-3 w-full" disabled={sending || verifying || !email} onClick={resend} type="button" variant="outline">
        {sending ? t('auth.verify.resending') : t('auth.verify.resend')}
      </Button>

      <div className="mt-5 text-center text-muted-foreground text-sm">
        <Link className="hover:text-primary hover:underline" search={{ email, invite: search.invite }} to="/sign-in">
          {t('auth.backToSignIn')}
        </Link>
      </div>
    </AuthLayout>
  );
}
