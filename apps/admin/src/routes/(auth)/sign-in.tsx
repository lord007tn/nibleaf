import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@nibleaf/design-system/components/ui/input-otp';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useOtpResendCountdown } from '@nibleaf/design-system/hooks/use-otp-resend-countdown';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/(auth)/sign-in')({
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { resendIn, resetCountdown, startCountdown } = useOtpResendCountdown();

  const requestCode = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email: email.trim().toLowerCase(), type: 'sign-in' });
      if (result.error) {
        setError(result.error.message ?? 'Could not send a sign-in code.');
        return;
      }
      setCodeSent(true);
      startCountdown();
    } catch {
      setError('Could not send a sign-in code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyCode = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await authClient.signIn.emailOtp({ email: email.trim().toLowerCase(), otp: otp.trim() });
      if (result.error) {
        setError(result.error.message ?? 'That code is invalid or expired.');
        return;
      }
      navigate({ to: '/' });
    } catch {
      setError('That code is invalid or expired.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (codeSent) {
      await verifyCode();
    } else {
      await requestCode();
    }
  };

  const useDifferentEmail = () => {
    setCodeSent(false);
    setOtp('');
    setError(null);
    resetCountdown();
  };

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            {codeSent ? <KeyRound className="size-5" /> : <ShieldCheck className="size-5" />}
          </span>
          <h1 className="mt-2 font-semibold text-2xl tracking-tight">{codeSent ? 'Enter your sign-in code' : 'Nibleaf Admin'}</h1>
          <p className="text-muted-foreground text-sm">
            {codeSent ? `We sent a one-time code to ${email.trim().toLowerCase()}.` : 'Secure, passwordless access for platform administrators.'}
          </p>
        </div>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {!codeSent ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Admin email</Label>
              <Input
                autoComplete="email"
                autoFocus
                id="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@company.com"
                required
                type="email"
                value={email}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2" dir="ltr">
              <Label htmlFor="otp">One-time code</Label>
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
              <p className="text-center text-muted-foreground text-xs">The code expires in 10 minutes and can be used once.</p>
            </div>
          )}
          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">{error}</p> : null}
          <Button className="mt-1 w-full" disabled={isSubmitting || (codeSent ? otp.length !== 6 : !email.trim())} type="submit">
            {isSubmitting ? (codeSent ? 'Verifying…' : 'Sending…') : 'Log in'}
          </Button>
          {codeSent ? (
            <div className="flex items-center justify-between">
              <Button onClick={useDifferentEmail} size="sm" type="button" variant="ghost">
                <ArrowLeft className="size-4" /> Change email
              </Button>
              <Button disabled={isSubmitting || resendIn > 0} onClick={requestCode} size="sm" type="button" variant="ghost">
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </Button>
            </div>
          ) : null}
        </form>
      </div>
    </main>
  );
}
