import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { JOIN_LINK_COOKIE, JOIN_LINK_COOKIE_MAX_AGE_SECONDS, joinLinkPath } from '@nibleaf/shared/join-links';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AuthProviders } from '@/components/auth-providers';
import { QueryErrorState } from '@/components/query-error-state';
import { useJoinWithLink } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { getPublicMetaQueryOptions, joinLinkPreviewQueryOptions, projectsQueryOptions } from '@/hooks/api/query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { syncDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { AuthLayout } from '@/layouts/auth';
import { clearPendingDestination, readPendingDestination, setPendingDestination } from '@/lib/invitations';
import { roleLabelKey } from '@/lib/member-roles';
import { useSession } from '@/services/auth-client';
import { signOutDashboard } from '@/services/dashboard-session';
import { rememberActiveProject } from '@/stores/active-project';

export const Route = createFileRoute('/join/$token')({
  loader: ({ context: { queryClient }, params: { token } }) => {
    prefetchRouteData(queryClient, joinLinkPreviewQueryOptions(token));
    prefetchRouteData(queryClient, getPublicMetaQueryOptions());
  },
  // The URL is a live credential: never crawl or index it.
  head: () => ({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] }),
  component: JoinPage,
});

/** Remember the link for the account about to be created, so sign-up skips the
 *  unrelated starter workspace (the server re-checks the link). One hour. */
const rememberJoinToken = (token: string) => {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  // biome-ignore lint/suspicious/noDocumentCookie: a plain first-party cookie the auth hook reads on sign-up.
  document.cookie = `${JOIN_LINK_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${JOIN_LINK_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
};
const forgetJoinToken = () => {
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookie set above.
  document.cookie = `${JOIN_LINK_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
};

/** Top-level, outside the (auth) layout, so it works signed in or out. */
function JoinPage() {
  return (
    <AuthProviders>
      <JoinContent />
    </AuthProviders>
  );
}

function JoinContent() {
  const t = useT();
  const { token } = Route.useParams();
  const path = joinLinkPath(token);
  const { data: session, isPending: sessionPending } = useSession();
  const preview = useQuery(joinLinkPreviewQueryOptions(token));
  const meta = useQuery(getPublicMetaQueryOptions());
  const join = useJoinWithLink();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<{ kind: 'domain' | 'unverified' | 'other'; domain?: string } | null>(null);
  const [switching, setSwitching] = useState(false);
  const invalid = preview.error instanceof ApiResponseError && preview.error.status === 404;
  // A refetch that 404s (revoked, regenerated or used up meanwhile) wins over
  // the preview fetched earlier: show the invalid state, never a stale offer.
  const info = invalid ? null : (preview.data ?? null);

  // A signed-out visitor goes to sign-in or sign-up and comes straight back here
  // (the (auth) pages honour the pending destination). A dead link is forgotten.
  useEffect(() => {
    if (invalid) {
      if (readPendingDestination() === path) clearPendingDestination();
      forgetJoinToken();
    } else if (!sessionPending && !session && info) {
      setPendingDestination(path);
      rememberJoinToken(token);
    }
  }, [invalid, sessionPending, session, info, path, token]);

  const site = info?.siteName ?? '';
  const role = info ? t(roleLabelKey(info.role)) : '';

  const finish = async (result: Awaited<ReturnType<typeof join.mutateAsync>>) => {
    if (readPendingDestination() === path) clearPendingDestination();
    forgetJoinToken();
    toast.success(t('join.joinedToast', { site }));
    // Same landing as an accepted invitation: this account's cache, a fresh
    // site list that includes the site, the site selected and open.
    if (session) syncDashboardSession(queryClient, session.user.id);
    await queryClient.invalidateQueries({ queryKey: projectsQueryOptions().queryKey });
    await queryClient.fetchQuery(projectsQueryOptions()).catch(() => undefined);
    if ('projectId' in result.landing) {
      rememberActiveProject(result.landing.projectId);
      await navigate({ to: '/app/projects/$projectId', params: { projectId: result.landing.projectId } });
    } else {
      await navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug: result.landing.organization } });
    }
  };

  const onJoin = () => {
    setError(null);
    join.mutate(token, {
      onSuccess: (result) => void finish(result),
      onError: (failure) => {
        const code = failure instanceof ApiResponseError ? failure.code : undefined;
        if (code === 'join:invalid') void preview.refetch();
        else if (code === 'join:domain_not_allowed') setError({ kind: 'domain', domain: info?.allowedDomain ?? undefined });
        else if (code === 'join:email_unverified') setError({ kind: 'unverified' });
        else setError({ kind: 'other' });
      },
    });
  };

  const switchAccount = async () => {
    setSwitching(true);
    try {
      await signOutDashboard(queryClient, async () => {
        setPendingDestination(path);
        rememberJoinToken(token);
        await navigate({ to: '/sign-in' });
      });
    } finally {
      setSwitching(false);
    }
  };

  const subtitle = info ? t('join.title', { site }) : t('join.subtitle');

  if (sessionPending || preview.isPending) {
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
    if (preview.isError && !invalid) {
      return (
        <AuthLayout subtitle={subtitle}>
          <QueryErrorState onRetry={() => void preview.refetch()} retrying={preview.isFetching} />
        </AuthLayout>
      );
    }
    return (
      <AuthLayout subtitle={subtitle}>
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-destructive text-sm" role="alert">
          {t('join.invalid')}
        </p>
        <Button className="mt-4 w-full" nativeButton={false} render={<Link to={session ? '/app' : '/sign-in'} />} variant="outline">
          {session ? t('auth.invite.goToApp') : t('auth.backToSignIn')}
        </Button>
      </AuthLayout>
    );
  }

  const details = (
    <>
      <p className="text-center text-sm">{t('join.offer', { role })}</p>
      <p className="text-center text-muted-foreground text-sm" dir="auto">
        {info.grants.map((grant) => `${grant.name} (${t(roleLabelKey(grant.role))})`).join(' · ')}
      </p>
      {info.allowedDomain ? (
        <p className="text-center text-muted-foreground text-sm" dir="auto">
          {t('join.domainOnly', { domain: info.allowedDomain })}
        </p>
      ) : null}
    </>
  );

  if (!session) {
    const signupDisabled = meta.data?.signupDisabled ?? false;
    return (
      <AuthLayout subtitle={subtitle}>
        <div className="flex flex-col gap-4">
          {details}
          <p className="text-center text-muted-foreground text-sm">{signupDisabled ? t('join.signupDisabled') : t('join.signInPrompt')}</p>
          {signupDisabled ? (
            <Button className="w-full" nativeButton={false} render={<Link to="/sign-in" />}>
              {t('join.logIn')}
            </Button>
          ) : (
            <>
              <Button className="w-full" nativeButton={false} render={<Link to="/sign-up" />}>
                {t('join.createAccount')}
              </Button>
              <p className="text-center text-muted-foreground text-sm">
                {t('auth.signUp.haveAccount')}{' '}
                <Link className="text-primary hover:underline" to="/sign-in">
                  {t('join.logIn')}
                </Link>
              </p>
            </>
          )}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle={subtitle}>
      <div className="flex flex-col gap-4">
        {details}
        <p className="text-center text-muted-foreground text-sm" dir="auto">
          {t('join.signedInAs', { email: session.user.email })}
        </p>
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm" role="alert">
            {error.kind === 'domain'
              ? t('join.wrongDomain', { domain: error.domain ?? '', email: session.user.email })
              : error.kind === 'unverified'
                ? t('join.unverified')
                : t('join.error')}
          </p>
        ) : null}
        {error?.kind === 'domain' ? (
          <Button className="w-full" loading={switching} onClick={() => void switchAccount()} type="button">
            {t('join.useAnotherAccount')}
          </Button>
        ) : (
          <Button className="w-full" loading={join.isPending} loadingText={t('join.joining')} onClick={onJoin} type="button">
            {t('join.joinButton', { site })}
          </Button>
        )}
        <Link
          className="text-center text-muted-foreground text-sm hover:underline"
          onClick={() => {
            clearPendingDestination();
            forgetJoinToken();
          }}
          to="/app"
        >
          {t('auth.invite.skip')}
        </Link>
      </div>
    </AuthLayout>
  );
}
