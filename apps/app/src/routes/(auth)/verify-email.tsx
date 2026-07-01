import { Button } from '@midad/design-system/components/ui/button';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AuthLayout } from '@/layouts/auth';
import { authClient, useSession } from '@/lib/auth-client';
import { useT } from '@/lib/i18n';

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
  const t = useT();
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
        toast.success(t('auth.verify.verifiedToast'));
        navigate({ to: '/app' });
      } catch {
        if (!cancelled) {
          toast.error(t('auth.verify.invalidLink'));
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
  }, [token, navigate, t]);

  const resend = async () => {
    if (!email) {
      toast.error(t('auth.verify.noEmail'));
      return;
    }
    setSending(true);
    try {
      const client = authClient as unknown as VerifyClient;
      await client.sendVerificationEmail?.({ email });
      toast.success(t('auth.verify.sentToast', { email }));
    } catch {
      toast.error(t('auth.verify.sendError'));
    } finally {
      setSending(false);
    }
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

      <Button className="mt-6 w-full" disabled={sending || verifying} onClick={resend} type="button">
        {sending ? t('auth.verify.resending') : t('auth.verify.resend')}
      </Button>

      <div className="mt-5 flex items-center justify-center gap-4 text-muted-foreground text-sm">
        <Link className="hover:text-primary hover:underline" to="/sign-in">
          {t('auth.backToSignIn')}
        </Link>
        <span className="text-border">·</span>
        <Link className="hover:text-primary hover:underline" to="/app">
          {t('auth.verify.continueToApp')}
        </Link>
      </div>
    </AuthLayout>
  );
}
