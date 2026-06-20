import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/layouts/auth';
import { authClient, useSession } from '@/lib/auth-client';

export const Route = createFileRoute('/(auth)/verify-email')({
  component: VerifyEmailPage,
  validateSearch: (s: Record<string, unknown>) => ({
    email: typeof s.email === 'string' ? s.email : '',
    token: typeof s.token === 'string' ? s.token : '',
  }),
});

// better-auth's email-verification methods are plugin/proxy-generated and may not be
// present on every build, so reach for them defensively.
type VerifyClient = {
  sendVerificationEmail?: (args: { email: string }) => Promise<unknown>;
  verifyEmail?: (args: { query: { token: string } }) => Promise<unknown>;
};

function VerifyEmailPage() {
  const navigate = useNavigate();
  const { email: emailParam, token } = Route.useSearch();
  const { data: session } = useSession();
  const email = emailParam || session?.user?.email || '';

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(Boolean(token));
  const [verified, setVerified] = useState(false);

  // If we arrived from an email link (?token=…), verify on mount.
  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const client = authClient as unknown as VerifyClient;
        await client.verifyEmail?.({ query: { token } });
        if (cancelled) {
          return;
        }
        setVerified(true);
        toast.success('Email verified');
        navigate({ to: '/app' });
      } catch {
        if (!cancelled) {
          toast.error('This verification link is invalid or has expired.');
        }
      } finally {
        if (!cancelled) {
          setVerifying(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  const resend = async () => {
    if (!email) {
      toast.error('No email address to send to.');
      return;
    }
    setSending(true);
    try {
      const client = authClient as unknown as VerifyClient;
      await client.sendVerificationEmail?.({ email });
      toast.success(`Verification link sent to ${email}`);
    } catch {
      toast.error('Could not send the verification email.');
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthLayout subtitle="One more step">
      <div className="text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
          <Mail className="size-6" />
        </div>
        <h1 className="font-semibold text-2xl tracking-tight">Verify your email</h1>
        <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
          {verifying ? (
            'Verifying your email…'
          ) : verified ? (
            'Your email is verified. Redirecting…'
          ) : email ? (
            <>
              We sent a verification link to <span className="font-medium text-foreground">{email}</span>
            </>
          ) : (
            'We sent you a verification link. Open it to finish setting up your account.'
          )}
        </p>
      </div>

      <Button className="mt-6 w-full" disabled={sending || verifying} onClick={resend} type="button">
        {sending ? 'Sending…' : 'Resend email'}
      </Button>

      <div className="mt-5 flex items-center justify-center gap-4 text-muted-foreground text-sm">
        <Link className="hover:text-primary hover:underline" to="/sign-in">
          Back to sign in
        </Link>
        <span className="text-border">·</span>
        <Link className="hover:text-primary hover:underline" to="/app">
          Continue to app
        </Link>
      </div>
    </AuthLayout>
  );
}
