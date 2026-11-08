import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AuthProviders } from '@/components/auth-providers';
import { QueryErrorState } from '@/components/query-error-state';
import { useGetInvitationInfo } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { getInvitationInfoQueryOptions, projectsQueryOptions } from '@/hooks/api/query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { syncDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { AuthLayout } from '@/layouts/auth';
import { clearPendingInvitation, readPendingInvitation, setPendingInvitation } from '@/lib/invitations';
import { authClient, useSession } from '@/services/auth-client';
import { signOutDashboard } from '@/services/dashboard-session';
import { rememberActiveProject } from '@/stores/active-project';

export const Route = createFileRoute('/accept-invite/$invitationId')({
  loader: ({ context: { queryClient }, params: { invitationId } }) => prefetchRouteData(queryClient, getInvitationInfoQueryOptions(invitationId)),
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
  const queryClient = useQueryClient();
  const [accepting, setAccepting] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invitation = useGetInvitationInfo(invitationId);
  const info = invitation.data ?? null;
  const missingInvitation = invitation.error instanceof ApiResponseError && invitation.error.status === 404;
  // Accepted (or otherwise closed) invitations can't be accepted again.
  const used = Boolean(info && info.status !== 'pending');

  // Stash the invitation so sign-in/up can route back here afterwards.
  useEffect(() => {
    if (info?.expired || used || missingInvitation || (invitation.isSuccess && !info)) {
      if (readPendingInvitation() === invitationId) clearPendingInvitation();
    } else if (!isPending && !session && info) {
      setPendingInvitation(invitationId);
    }
  }, [isPending, session, invitationId, info, used, invitation.isSuccess, missingInvitation]);

  const accept = async () => {
    setError(null);
    setAccepting(true);
    try {
      const { data: accepted, error: acceptError } = await authClient.organization.acceptInvitation({ invitationId });
      if (acceptError) {
        const blob = `${acceptError.code ?? ''} ${acceptError.message ?? ''}`.toUpperCase();
        if (blob.includes('RECIPIENT') && info) {
          setError(t('auth.invite.wrongAccount', { email: info.email }));
        } else if (blob.includes('EXPIRED')) {
          if (readPendingInvitation() === invitationId) clearPendingInvitation();
          setError(t('auth.invite.expiredError'));
        } else {
          // Better Auth's message is English and technical; keep the localized one.
          setError(t('auth.invite.error'));
        }
        return;
      }
      clearPendingInvitation();
      toast.success(t('auth.invite.acceptedToast'));
      // Open the site they just joined, selected, instead of whichever site the
      // dashboard last had open (an existing user's own site). The site list is
      // refetched so it includes the new site.
      const organizationId = accepted?.invitation?.organizationId;
      // Bind the dashboard cache to this account first: after "Log in with the
      // invited account", /app would otherwise see a new user and clear the
      // selection made below.
      if (session) syncDashboardSession(queryClient, session.user.id);
      await queryClient.invalidateQueries({ queryKey: projectsQueryOptions().queryKey });
      const sites = organizationId ? await queryClient.fetchQuery(projectsQueryOptions()).catch(() => []) : [];
      const joined = sites.find((site) => site.organizationId === organizationId);
      if (joined) {
        rememberActiveProject(joined.id);
        await navigate({ to: '/app/projects/$projectId', params: { projectId: joined.id } });
      } else {
        await navigate({ to: '/app' });
      }
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
      await signOutDashboard(queryClient, async () => {
        setPendingInvitation(invitationId);
        await navigate({ to: '/sign-in', search: { invite: invitationId, email: info.email } });
      });
    } catch {
      setError(t('auth.invite.switchAccountError'));
    } finally {
      setSwitchingAccount(false);
    }
  };

  // Expired / missing invitations still need a way forward.
  const nextStep = (
    <Button className="mt-4 w-full" nativeButton={false} render={<Link to={session ? '/app' : '/sign-in'} />} variant="outline">
      {session ? t('auth.invite.goToApp') : t('auth.backToSignIn')}
    </Button>
  );

  const subtitle = info?.organizationName ? t('auth.invite.joinPrompt', { org: info.organizationName }) : t('auth.invite.subtitle');

  if (isPending || invitation.isPending) {
    // Shaped like the invitation card: who it's for, the prompt, then the action.
    return (
      <AuthLayout subtitle={subtitle}>
        <div aria-busy="true" className="flex flex-col items-center gap-4">
          <p className="sr-only" role="status">
            {t('common.loading')}
          </p>
          <Skeleton aria-hidden className="h-4 w-3/4" />
          <Skeleton aria-hidden className="h-4 w-2/3" />
          <Skeleton aria-hidden className="h-9 w-full" />
        </div>
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
        {nextStep}
      </AuthLayout>
    );
  }

  if (used || info.expired) {
    return (
      <AuthLayout subtitle={subtitle}>
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-destructive text-sm">
          {used ? t('auth.invite.alreadyUsed') : t('auth.invite.expiredError')}
        </p>
        {nextStep}
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
          <Button className="w-full" loading={switchingAccount} onClick={switchAccount} type="button">
            {t('auth.invite.switchAccount')}
          </Button>
        ) : (
          <Button className="w-full" loading={accepting} loadingText={t('auth.invite.accepting')} onClick={accept} type="button">
            {t('auth.invite.accept')}
          </Button>
        )}
        <Link className="text-center text-muted-foreground text-sm hover:underline" onClick={clearPendingInvitation} to="/app">
          {t('auth.invite.skip')}
        </Link>
      </div>
    </AuthLayout>
  );
}
