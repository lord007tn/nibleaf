import { Avatar, AvatarFallback, AvatarImage } from '@nibleaf/design-system/components/ui/avatar';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { JOIN_LINK_COOKIE, JOIN_LINK_COOKIE_MAX_AGE_SECONDS, joinLinkPath } from '@nibleaf/shared/join-links';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { QueryErrorState } from '@/components/query-error-state';
import { acceptInvitation } from '@/hooks/api/admissions';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { organizationProjectsQueryOptions, switcherQueryOptions } from '@/hooks/api/organization-query-options';
import {
  getInvitationInfoQueryOptions,
  getPublicMetaQueryOptions,
  joinLinkPreviewQueryOptions,
  projectsQueryOptions,
} from '@/hooks/api/query-options';
import { syncDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { AuthLayout } from '@/layouts/auth';
import {
  clearPendingDestination,
  clearPendingInvitation,
  forgetAcceptIntent,
  readPendingDestination,
  readPendingInvitation,
  rememberAcceptIntent,
  setPendingDestination,
  setPendingInvitation,
  takeAcceptIntent,
} from '@/lib/invitations';
import { useSession } from '@/services/auth-client';
import { signOutDashboard } from '@/services/dashboard-session';
import { rememberActiveProject } from '@/stores/active-project';
import { useJoinWithLink } from '../api/mutations';
import { type AdmissionGrant, invitationState, joinState, type Landing } from '../model/admission';
import { initialsFor } from '../model/person';
import { siteRoleLabel } from '../model/roles';

/** The tab title follows the state the page shows (PUBLIC-09: no generic title). */
function useDocumentTitle(title: string) {
  useEffect(() => {
    if (title) document.title = `${title} — Nibleaf`;
  }, [title]);
}

/** Where a person lands after joining or when they already have access (design §6.3.2). */
function useLand() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  return async (landing: Landing) => {
    if (session) syncDashboardSession(queryClient, session.user.id);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: projectsQueryOptions().queryKey }),
      queryClient.invalidateQueries({ queryKey: switcherQueryOptions().queryKey }),
    ]);
    if ('projectId' in landing) {
      rememberActiveProject(landing.projectId);
      await navigate({ to: '/app/projects/$projectId', params: { projectId: landing.projectId } });
    } else await navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug: landing.organization } });
  };
}

/** The org the invitation or link is for, who sent it, and what it gives. */
function AccessCard({
  organizationName,
  logo,
  inviter,
  orgRole,
  grants,
  footer,
}: {
  organizationName: string;
  logo?: string | null;
  inviter: string | null;
  orgRole: string;
  grants: AdmissionGrant[];
  footer?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="grid gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-10 rounded-lg">
          {logo ? <AvatarImage alt="" src={logo} /> : null}
          <AvatarFallback className="rounded-lg font-semibold">{initialsFor(organizationName, organizationName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="break-words font-medium">
            <bdi>{organizationName}</bdi>
          </p>
          {inviter ? <p className="text-muted-foreground text-sm">{t('people.admission.invitedBy', { name: inviter })}</p> : null}
        </div>
      </div>
      <div className="grid gap-2">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{t('people.admission.youGet')}</p>
        {orgRole === 'admin' || orgRole === 'owner' ? (
          <p className="text-sm">{t(orgRole === 'owner' ? 'people.admission.ownerAccess' : 'people.admission.adminAccess')}</p>
        ) : grants.length ? (
          <ul className="grid gap-1.5">
            {grants.map((grant) => (
              <li className="flex min-w-0 items-center justify-between gap-3 text-sm" key={grant.projectId}>
                <bdi className="min-w-0 truncate">{grant.name}</bdi>
                <Badge className="shrink-0 font-normal" variant="outline">
                  {t(siteRoleLabel(grant.role))}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t('people.admission.noWebsites')}</p>
        )}
      </div>
      {footer}
    </div>
  );
}

/** What Nibleaf is, in one line, for people arriving from a link. */
function AboutNibleaf() {
  const t = useT();
  return <p className="text-center text-muted-foreground text-xs">{t('people.admission.about')}</p>;
}

function LoadingCard({ title }: { title: string }) {
  const t = useT();
  return (
    <AuthLayout subtitle={title}>
      <div aria-busy="true" className="grid gap-4">
        <p className="sr-only" role="status">
          {t('common.loading')}
        </p>
        <Skeleton aria-hidden className="h-36 w-full rounded-xl" />
        <Skeleton aria-hidden className="h-9 w-full" />
      </div>
    </AuthLayout>
  );
}

/** One calm state for a link or invitation that can't be used, with actions that fit who is looking (PUBLIC-09). */
function Problem({ title, message, signedIn, children }: { title: string; message: string; signedIn: boolean; children?: ReactNode }) {
  const t = useT();
  useDocumentTitle(title);
  return (
    <AuthLayout subtitle={title}>
      <div className="grid gap-4">
        <p className="text-muted-foreground text-sm">{message}</p>
        {children}
        {signedIn ? (
          <Button className="w-full" nativeButton={false} render={<Link to="/app" />}>
            {t('people.admission.goToApp')}
          </Button>
        ) : (
          <>
            <Button className="w-full" nativeButton={false} render={<Link to="/sign-in" />}>
              {t('people.admission.logIn')}
            </Button>
            <Button className="w-full" nativeButton={false} render={<Link to="/sign-up" />} variant="outline">
              {t('people.admission.createAccount')}
            </Button>
          </>
        )}
        <AboutNibleaf />
      </div>
    </AuthLayout>
  );
}

// ─── /accept-invite/$invitationId ───────────────────────────────────────────

/** Every case of an email invitation (design §6.3), one state at a time. */
export function AcceptInvitationView({ invitationId }: { invitationId: string }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const land = useLand();
  const { data: session, isPending: sessionPending } = useSession();
  const invitation = useQuery(getInvitationInfoQueryOptions(invitationId));
  const switcher = useQuery({ ...switcherQueryOptions(), enabled: Boolean(session) });
  const [accepting, setAccepting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const errorStatus = invitation.error instanceof ApiResponseError ? invitation.error.status : invitation.error ? 0 : null;
  const state = invitationState({
    pending: sessionPending || invitation.isPending || (Boolean(session) && switcher.isPending && !switcher.isError),
    errorStatus,
    info: invitation.data ?? null,
    session: session ? { email: session.user.email } : null,
    memberships: switcher.data?.organizations ?? [],
  });

  // Remember the invitation through sign-in/up; forget it once it can't be used.
  useEffect(() => {
    if (state.kind === 'invalid' || state.kind === 'expired' || state.kind === 'used') {
      if (readPendingInvitation() === invitationId) clearPendingInvitation();
      forgetAcceptIntent(invitationId);
    } else if (state.kind === 'signedOut') setPendingInvitation(invitationId);
  }, [state.kind, invitationId]);

  const organizationName = invitation.data?.organizationName ?? '';
  const accept = async () => {
    setAccepting(true);
    setFailure(null);
    try {
      const accepted = await acceptInvitation(invitationId);
      clearPendingInvitation();
      toast.success(t('people.admission.joinedToast', { org: organizationName }));
      await land(accepted.landing);
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 404) {
        if (readPendingInvitation() === invitationId) clearPendingInvitation();
        void invitation.refetch();
      }
      setFailure(t('people.admission.acceptFailed'));
    } finally {
      setAccepting(false);
    }
  };

  // Back from "Create an account to accept" or "Log in to accept", signed in as
  // the invited address: they already said yes, so accept without asking again
  // (P3-JRN-003). If it fails, the page offers Accept with the reason.
  const autoAccepted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the invitation becomes acceptable.
  useEffect(() => {
    if (state.kind !== 'ready' || autoAccepted.current || !takeAcceptIntent(invitationId)) return;
    autoAccepted.current = true;
    void accept();
  }, [state.kind, invitationId]);

  const title =
    state.kind === 'loading' || state.kind === 'error'
      ? t('people.admission.invitationTitle')
      : state.kind === 'invalid'
        ? t('people.admission.invalidInvitation')
        : state.kind === 'expired'
          ? t('people.admission.expired')
          : state.kind === 'used'
            ? t('people.admission.used')
            : t('people.admission.join', { org: state.info.organizationName });
  useDocumentTitle(title);

  if (state.kind === 'loading') return <LoadingCard title={title} />;
  if (state.kind === 'error')
    return (
      <AuthLayout subtitle={title}>
        <QueryErrorState onRetry={() => void invitation.refetch()} retrying={invitation.isFetching} />
      </AuthLayout>
    );
  if (state.kind === 'invalid') return <Problem message={t('people.admission.invalidInvitationHint')} signedIn={Boolean(session)} title={title} />;
  if (state.kind === 'expired')
    return (
      <Problem
        message={
          state.info.inviterName
            ? t('people.admission.expiredHint', { name: state.info.inviterName })
            : t('people.admission.expiredHintNoName', { org: state.info.organizationName })
        }
        signedIn={Boolean(session)}
        title={title}
      />
    );
  if (state.kind === 'used')
    return state.membership ? (
      <AuthLayout subtitle={title}>
        <div className="grid gap-4">
          <p className="text-muted-foreground text-sm">{t('people.admission.usedMember', { org: state.info.organizationName })}</p>
          <Button className="w-full" onClick={() => state.membership && void land({ organization: state.membership.slug })} type="button">
            {t('people.admission.openOrg', { org: state.info.organizationName })}
          </Button>
        </div>
      </AuthLayout>
    ) : (
      <Problem message={t('people.admission.usedHint')} signedIn={Boolean(session)} title={title} />
    );

  const { info } = state;
  const card = (
    <AccessCard
      grants={info.grants}
      inviter={info.inviterName}
      logo={invitation.data?.organizationLogo}
      organizationName={info.organizationName}
      orgRole={info.orgRole}
    />
  );

  if (state.kind === 'signedOut') {
    const search = { invite: invitationId, email: info.email };
    return (
      <AuthLayout subtitle={title}>
        <div className="grid gap-4">
          {card}
          <p className="text-muted-foreground text-sm">{t('people.admission.forEmail', { email: info.email })}</p>
          <Button
            className="w-full"
            nativeButton={false}
            render={<Link onClick={() => rememberAcceptIntent(invitationId)} search={search} to="/sign-up" />}
          >
            {t('people.admission.createToAccept')}
          </Button>
          <Button
            className="w-full"
            nativeButton={false}
            render={<Link onClick={() => rememberAcceptIntent(invitationId)} search={search} to="/sign-in" />}
            variant="outline"
          >
            {t('people.admission.logInToAccept')}
          </Button>
          <AboutNibleaf />
        </div>
      </AuthLayout>
    );
  }

  if (state.kind === 'wrongAccount') {
    const switchAccount = async () => {
      setSwitching(true);
      setFailure(null);
      try {
        await signOutDashboard(queryClient, async () => {
          setPendingInvitation(invitationId);
          rememberAcceptIntent(invitationId);
          await navigate({ to: '/sign-in', search: { invite: invitationId, email: info.email } });
        });
      } catch {
        setFailure(t('auth.invite.switchAccountError'));
      } finally {
        setSwitching(false);
      }
    };
    return (
      <AuthLayout subtitle={title}>
        <div className="grid gap-4">
          {card}
          <Callout tone="warning">{t('people.admission.wrongAccount', { email: info.email, current: state.signedInAs })}</Callout>
          {failure ? <Callout tone="danger">{failure}</Callout> : null}
          <Button className="w-full" loading={switching} onClick={() => void switchAccount()} type="button">
            {t('people.admission.switchAccount')}
          </Button>
          <Button
            className="w-full"
            nativeButton={false}
            render={
              <Link
                onClick={() => {
                  clearPendingInvitation();
                  forgetAcceptIntent(invitationId);
                }}
                to="/app"
              />
            }
            variant="ghost"
          >
            {t('people.admission.notNow')}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  const note =
    state.note === 'alreadyMember'
      ? t('people.admission.noteMember', { org: info.organizationName })
      : state.note === 'becomeAdmin'
        ? t('people.admission.noteAdmin', { org: info.organizationName })
        : state.note === 'alreadyEverything'
          ? t('people.admission.noteEverything', { org: info.organizationName })
          : null;
  return (
    <AuthLayout subtitle={title}>
      <div className="grid gap-4">
        {card}
        {note ? <Callout tone="info">{note}</Callout> : null}
        {failure ? <Callout tone="danger">{failure}</Callout> : null}
        <Button className="w-full" loading={accepting} loadingText={t('auth.invite.accepting')} onClick={() => void accept()} type="button">
          {t('people.admission.accept')}
        </Button>
        <Button
          className="w-full"
          nativeButton={false}
          render={
            <Link
              onClick={() => {
                clearPendingInvitation();
                forgetAcceptIntent(invitationId);
              }}
              to="/app"
            />
          }
          variant="ghost"
        >
          {t('people.admission.notNow')}
        </Button>
      </div>
    </AuthLayout>
  );
}

// ─── /join/$token ───────────────────────────────────────────────────────────

/** Remember the link for the account about to be created, so sign-up skips the
 *  unrelated starter organization (the server re-checks the link). One hour. */
const rememberJoinToken = (token: string) => {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  // biome-ignore lint/suspicious/noDocumentCookie: a plain first-party cookie the auth hook reads on sign-up.
  document.cookie = `${JOIN_LINK_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${JOIN_LINK_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
};
const forgetJoinToken = () => {
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookie set above.
  document.cookie = `${JOIN_LINK_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
};

/** Every case of a join link (design §6.4), one state at a time. */
export function JoinLinkView({ token }: { token: string }) {
  const t = useT();
  const path = joinLinkPath(token);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const land = useLand();
  const { data: session, isPending: sessionPending } = useSession();
  const preview = useQuery(joinLinkPreviewQueryOptions(token));
  const meta = useQuery(getPublicMetaQueryOptions());
  const switcher = useQuery({ ...switcherQueryOptions(), enabled: Boolean(session) });
  const organizationId = preview.data?.organizationId;
  const membership = switcher.data?.organizations.find((org) => org.id === organizationId);
  // A plain Member's roles on the link's websites decide "you already have this".
  const websites = useQuery({ ...organizationProjectsQueryOptions(organizationId), enabled: membership?.orgRole === 'member' });
  const join = useJoinWithLink();
  const [failure, setFailure] = useState<'unverified' | 'domain' | 'other' | null>(null);
  const [switching, setSwitching] = useState(false);
  const errorStatus = preview.error instanceof ApiResponseError ? preview.error.status : preview.error ? 0 : null;
  const state = joinState({
    pending: sessionPending || preview.isPending || (Boolean(session) && switcher.isPending && !switcher.isError),
    errorStatus,
    preview: errorStatus === 404 ? null : (preview.data ?? null),
    session: session ? { email: session.user.email } : null,
    memberships: switcher.data?.organizations ?? [],
    siteRoles: websites.data ? Object.fromEntries(websites.data.map((site) => [site.id, site.role])) : websites.isError ? {} : null,
  });

  useEffect(() => {
    if (state.kind === 'invalid' || state.kind === 'alreadyMember') {
      if (readPendingDestination() === path) clearPendingDestination();
      forgetJoinToken();
    } else if (state.kind === 'signedOut') {
      setPendingDestination(path);
      rememberJoinToken(token);
    }
  }, [state.kind, path, token]);

  const orgName = 'preview' in state ? state.preview.organizationName : '';
  const title =
    state.kind === 'loading' || state.kind === 'error'
      ? t('people.admission.linkTitle')
      : state.kind === 'invalid'
        ? t('people.admission.invalidLink')
        : state.kind === 'alreadyMember'
          ? t('people.admission.alreadyMember', { org: orgName })
          : t('people.admission.join', { org: orgName });
  useDocumentTitle(title);

  if (state.kind === 'loading') return <LoadingCard title={title} />;
  if (state.kind === 'error')
    return (
      <AuthLayout subtitle={title}>
        <QueryErrorState onRetry={() => void preview.refetch()} retrying={preview.isFetching} />
      </AuthLayout>
    );
  if (state.kind === 'invalid') return <Problem message={t('people.admission.invalidLinkHint')} signedIn={Boolean(session)} title={title} />;

  const { preview: info } = state;
  const card = (
    <AccessCard
      footer={
        info.allowedDomain ? (
          <p className="text-muted-foreground text-xs">{t('people.admission.domainOnly', { domain: info.allowedDomain })}</p>
        ) : null
      }
      grants={info.grants}
      inviter={info.inviterName}
      organizationName={info.organizationName}
      orgRole="member"
    />
  );

  if (state.kind === 'alreadyMember') {
    const single =
      'projectId' in state.landing ? info.grants.find((grant) => 'projectId' in state.landing && grant.projectId === state.landing.projectId) : null;
    return (
      <AuthLayout subtitle={title}>
        <div className="grid gap-4">
          <p className="text-muted-foreground text-sm">{t('people.admission.alreadyMemberHint')}</p>
          <Button className="w-full" onClick={() => void land(state.landing)} type="button">
            {single ? t('people.admission.openSite', { site: single.name }) : t('people.admission.openOrg', { org: info.organizationName })}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (state.kind === 'signedOut') {
    const signupDisabled = meta.data?.signupDisabled ?? false;
    return (
      <AuthLayout subtitle={title}>
        <div className="grid gap-4">
          {card}
          {signupDisabled ? <p className="text-muted-foreground text-sm">{t('join.signupDisabled')}</p> : null}
          {signupDisabled ? null : (
            <Button className="w-full" nativeButton={false} render={<Link to="/sign-up" />}>
              {t('people.admission.createToJoin')}
            </Button>
          )}
          <Button className="w-full" nativeButton={false} render={<Link to="/sign-in" />} variant={signupDisabled ? 'default' : 'outline'}>
            {t('people.admission.logInToJoin')}
          </Button>
          <AboutNibleaf />
        </div>
      </AuthLayout>
    );
  }

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

  if (state.kind === 'wrongDomain' || failure === 'domain')
    return (
      <AuthLayout subtitle={title}>
        <div className="grid gap-4">
          {card}
          <Callout tone="warning">
            {t('people.admission.wrongDomain', { domain: info.allowedDomain ?? '', email: session?.user.email ?? '' })}
          </Callout>
          <Button className="w-full" loading={switching} onClick={() => void switchAccount()} type="button">
            {t('people.admission.useAnotherAccount')}
          </Button>
        </div>
      </AuthLayout>
    );

  const onJoin = () => {
    setFailure(null);
    join.mutate(token, {
      onSuccess: async (result) => {
        if (readPendingDestination() === path) clearPendingDestination();
        forgetJoinToken();
        toast.success(t('people.admission.joinedToast', { org: info.organizationName }));
        await land(result.landing);
      },
      onError: (error) => {
        const code = error instanceof ApiResponseError ? error.code : undefined;
        if (code === 'join:invalid') void preview.refetch();
        else setFailure(code === 'join:domain_not_allowed' ? 'domain' : code === 'join:email_unverified' ? 'unverified' : 'other');
      },
    });
  };
  return (
    <AuthLayout subtitle={title}>
      <div className="grid gap-4">
        {card}
        <p className="text-muted-foreground text-sm">{t('people.admission.signedInAs', { email: session?.user.email ?? '' })}</p>
        {state.note === 'alreadyMember' ? <Callout tone="info">{t('people.admission.noteMember', { org: info.organizationName })}</Callout> : null}
        {failure ? <Callout tone="danger">{t(failure === 'unverified' ? 'join.unverified' : 'people.admission.joinFailed')}</Callout> : null}
        <Button className="w-full" loading={join.isPending} loadingText={t('join.joining')} onClick={onJoin} type="button">
          {t('people.admission.joinButton', { org: info.organizationName })}
        </Button>
        <Button
          className="w-full"
          nativeButton={false}
          render={
            <Link
              onClick={() => {
                clearPendingDestination();
                forgetJoinToken();
              }}
              to="/app"
            />
          }
          variant="ghost"
        >
          {t('people.admission.notNow')}
        </Button>
      </div>
    </AuthLayout>
  );
}
