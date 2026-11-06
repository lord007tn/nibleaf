import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@nibleaf/design-system/components/ui/input-otp';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useOtpResendCountdown } from '@nibleaf/design-system/hooks/use-otp-resend-countdown';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { GoogleIcon } from '@/components/icons/brand';
import { useGetPublicMeta } from '@/hooks/api/public';
import { AuthLayout } from '@/layouts/auth';
import { friendlyAuthError } from '@/lib/auth-errors';
import { readPendingInvitation } from '@/lib/invitations';
import { currentOAuthQuery } from '@/lib/mcp-oauth';
import { authClient, signIn } from '@/services/auth-client';

export const Route = createFileRoute('/(auth)/sign-in')({
  validateSearch: (search) =>
    z
      .object({
        invite: z.string().optional().catch(undefined),
        email: z.string().optional().catch(undefined),
        // An MCP OAuth request handed off by the API (see lib/mcp-oauth).
        oauth_request: z.string().optional().catch(undefined),
      })
      .parse(search),
  head: () => ({ meta: [{ title: 'Log in — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: SignInPage,
});

const isRedirect = (value: unknown) =>
  typeof value === 'object' &&
  value !== null &&
  (value as { redirect?: unknown }).redirect === true &&
  typeof (value as { url?: unknown }).url === 'string';

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
  const { data: publicMeta } = useGetPublicMeta();
  const googleEnabled = publicMeta?.providers.google ?? false;

  const normalizedEmail = email.trim().toLowerCase();
  // An MCP OAuth request: sign-in carries it so Better Auth resumes the flow.
  const [oauthQuery, setOauthQuery] = useState<string | null>(null);
  useEffect(() => setOauthQuery(currentOAuthQuery()), []);
  const connectingApp = oauthQuery !== null;
  const oauthBody = oauthQuery ? { oauth_query: oauthQuery } : {};
  const invitationId = search.invite ?? readPendingInvitation() ?? undefined;
  const afterAuthPath = invitationId ? `/accept-invite/${invitationId}` : '/app';

  const finishSignIn = async (result: unknown) => {
    // During an MCP OAuth request Better Auth answers sign-in with the next
    // step ({ redirect, url }) and the auth client follows it.
    if (isRedirect(result)) return;
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
      const result = await authClient.signIn.emailOtp({ email: normalizedEmail, otp: otp.trim(), ...oauthBody });
      if (result.error) {
        setError(friendlyAuthError(result.error, t, t('auth.otp.invalid')));
        return;
      }
      await finishSignIn(result.data);
    } catch {
      setError(t('auth.error.tryAgain'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const signInWithGoogle = async () => {
    setError(null);
    setIsGoogleSubmitting(true);
    // With an OAuth request, Google's callback resumes it instead of opening callbackURL.
    const result = await signIn.social({ provider: 'google', callbackURL: afterAuthPath, ...oauthBody });
    if (result.error) {
      setError(friendlyAuthError(result.error, t, t('auth.signIn.error')));
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
      {connectingApp && !codeSent ? <p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">{t('auth.oauth.signInNotice')}</p> : null}
      {!codeSent && googleEnabled ? (
        <>
          <Button className="mb-4 w-full gap-2" disabled={isGoogleSubmitting} onClick={signInWithGoogle} type="button" variant="outline">
            <GoogleIcon className="size-4" />
            {isGoogleSubmitting ? t('auth.google.submitting') : t('auth.google.signIn')}
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
              <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t('auth.otp.differentEmail')}
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
          <p className="mt-5 text-center text-muted-foreground text-sm" hidden={connectingApp}>
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
