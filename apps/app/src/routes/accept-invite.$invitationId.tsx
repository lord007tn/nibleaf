import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/layouts/auth';
import { authClient, useSession } from '@/lib/auth-client';
import { useT } from '@/lib/i18n';

export const Route = createFileRoute('/accept-invite/$invitationId')({
  component: AcceptInvitePage,
});

/** Top-level so it resolves whether or not the user is authenticated. */
function AcceptInvitePage() {
  const t = useT();
  const { invitationId } = Route.useParams();
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setError(null);
    setAccepting(true);
    const { error: acceptError } = await authClient.organization.acceptInvitation({ invitationId });
    setAccepting(false);
    if (acceptError) {
      setError(acceptError.message ?? t('auth.invite.error'));
      return;
    }
    toast.success(t('auth.invite.acceptedToast'));
    navigate({ to: '/app' });
  };

  if (isPending) {
    return (
      <AuthLayout subtitle={t('auth.invite.subtitle')}>
        <p className="text-center text-muted-foreground text-sm">{t('common.loading')}</p>
      </AuthLayout>
    );
  }

  if (!session) {
    // Stash the invitation so it can be picked up after the user signs in/up.
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('plume.pendingInvitation', invitationId);
    }
    return (
      <AuthLayout subtitle={t('auth.invite.subtitle')}>
        <div className="flex flex-col gap-4">
          <p className="text-center text-muted-foreground text-sm">{t('auth.invite.signInPrompt')}</p>
          <Button className="w-full" render={<Link to="/sign-up" />}>
            {t('auth.invite.createAccount')}
          </Button>
          <p className="text-center text-muted-foreground text-sm">
            {t('auth.signUp.haveAccount')}{' '}
            <Link className="text-primary hover:underline" to="/sign-in">
              {t('auth.signIn.submit')}
            </Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle={t('auth.invite.subtitle')}>
      <div className="flex flex-col gap-4">
        <p className="text-center text-muted-foreground text-sm">{t('auth.invite.acceptPrompt')}</p>
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">{error}</p> : null}
        <Button className="w-full" disabled={accepting} onClick={accept} type="button">
          {accepting ? t('auth.invite.accepting') : t('auth.invite.accept')}
        </Button>
        <Link className="text-center text-muted-foreground text-sm hover:underline" to="/app">
          {t('auth.invite.skip')}
        </Link>
      </div>
    </AuthLayout>
  );
}
