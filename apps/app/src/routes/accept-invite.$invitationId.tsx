import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AuthProviders } from '@/components/auth-providers';
import { QueryErrorState } from '@/components/query-error-state';
import { useGetInvitationInfo } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { AuthLayout } from '@/layouts/auth';
import { clearPendingInvitation, readPendingInvitation, setPendingInvitation } from '@/lib/invitations';
import { authClient, useSession } from '@/services/auth-client';

export const Route = createFileRoute('/accept-invite/$invitationId')({
  // Not under the (auth) layout, so noindex it directly: the URL carries a live
  // invitation token that must never be crawled or indexed.
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: AcceptInvitePage,
});

/** Top-level so it resolves whether or not the user is authenticated. */
function AcceptInvitePage() {
  return (
    <AuthProviders>
      <AcceptInviteContent />
    </AuthProviders>
  );
}

function AcceptInviteContent() {
  const t = useT();
  const { invitationId } = Route.useParams();
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invitation = useGetInvitationInfo(invitationId);
  const info = invitation.data ?? null;
  const missingInvitation = invitation.error instanceof ApiResponseError && invitation.error.status === 404;

  // Stash the invitation so sign-in/up can route back here afterwards.
  useEffect(() => {
    if (info?.expired || missingInvitation || (invitation.isSuccess && !info)) {
      if (readPendingInvitation() === invitationId) clearPendingInvitation();
    } else if (!isPending && !session && info) {
      setPendingInvitation(invitationId);
    }
  }, [isPending, session, invitationId, info, invitation.isSuccess, missingInvitation]);

  const accept = async () => {
    setError(null);
    setAccepting(true);
    try {
      const { error: acceptError } = await authClient.organization.acceptInvitation({ invitationId });
      if (acceptError) {
        const blob = `${acceptError.code ?? ''} ${acceptError.message ?? ''}`.toUpperCase();
        if (blob.includes('RECIPIENT') && info) {
          setError(t('auth.invite.wrongAccount', { email: info.email }));
        } else if (blob.includes('EXPIRED')) {
          if (readPendingInvitation() === invitationId) clearPendingInvitation();
          setError(t('auth.invite.expiredError'));
        } else {
          setError(acceptError.message ?? t('auth.invite.error'));
        }
        return;
      }
      clearPendingInvitation();
      toast.success(t('auth.invite.acceptedToast'));
      await navigate({ to: '/app' });
    } catch {
      setError(t('auth.invite.error'));
    } finally {
      setAccepting(false);
    }
  };

  const switchAccount = async () => {
    if (!info) return;
    setError(null);
    setSwitchingAccount(true);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
      setPendingInvitation(invitationId);
      await navigate({ to: '/sign-in', search: { invite: invitationId, email: info.email } });
    } catch {
      setError(t('auth.invite.switchAccountError'));
    } finally {
      setSwitchingAccount(false);
    }
  };

  const subtitle = info?.organizationName ? t('auth.invite.joinPrompt', { org: info.organizationName }) : t('auth.invite.subtitle');

  if (isPending || invitation.isPending) {
    return (
      <AuthLayout subtitle={subtitle}>
        <p className="text-center text-muted-foreground text-sm">{t('common.loading')}</p>
      </AuthLayout>
    );
  }

  if (!info) {
    if (invitation.isError && !missingInvitation) {
      return (
        <AuthLayout subtitle={subtitle}>
          <QueryErrorState onRetry={() => void invitation.refetch()} retrying={invitation.isFetching} />
        </AuthLayout>
      );
    }
    return (
      <AuthLayout subtitle={subtitle}>
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-destructive text-sm">
          {t('auth.invite.notFound')}
        </p>
      </AuthLayout>
    );
  }

  if (info.expired) {
    return (
      <AuthLayout subtitle={subtitle}>
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-destructive text-sm">
          {t('auth.invite.expiredError')}
        </p>
      </AuthLayout>
    );
  }

  if (!session) {
    const search = { invite: invitationId, email: info.email };
    return (
      <AuthLayout subtitle={subtitle}>
        <div className="flex flex-col gap-4">
          <p className="text-center text-muted-foreground text-sm">{t('auth.invite.invitedAs', { email: info.email })}</p>
          <p className="text-center text-muted-foreground text-sm">{t('auth.invite.signInPrompt')}</p>
          <Button className="w-full" nativeButton={false} render={<Link search={search} to="/sign-up" />}>
            {t('auth.invite.createAccountToJoin')}
          </Button>
          <p className="text-center text-muted-foreground text-sm">
            {t('auth.signUp.haveAccount')}{' '}
            <Link className="text-primary hover:underline" search={search} to="/sign-in">
              {t('auth.invite.signInToJoin')}
            </Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  // Signed in, but with a different address than the invite was sent to.
  const mismatch = session.user.email.toLowerCase() !== info.email.toLowerCase();

  return (
    <AuthLayout subtitle={subtitle}>
      <div className="flex flex-col gap-4">
        <p className="text-center text-muted-foreground text-sm">{t('auth.invite.invitedAs', { email: info.email })}</p>
        {mismatch ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 text-sm dark:text-amber-400">
            {t('auth.invite.wrongAccount', { email: info.email })}
          </p>
        ) : (
          <p className="text-center text-muted-foreground text-sm">{t('auth.invite.acceptPrompt')}</p>
        )}
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">{error}</p> : null}
        {mismatch ? (
          <Button className="w-full" disabled={switchingAccount} onClick={switchAccount} type="button">
            {switchingAccount ? t('common.loading') : t('auth.invite.switchAccount')}
          </Button>
        ) : (
          <Button className="w-full" disabled={accepting} onClick={accept} type="button">
            {accepting ? t('auth.invite.accepting') : t('auth.invite.accept')}
          </Button>
        )}
        <Link className="text-center text-muted-foreground text-sm hover:underline" onClick={clearPendingInvitation} to="/app">
          {t('auth.invite.skip')}
        </Link>
      </div>
    </AuthLayout>
  );
}
