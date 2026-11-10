import { NibleafMark } from '@nibleaf/design-system/brand';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Building2, Mail } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { OrgAvatar } from '@/components/app/org-switcher/org-avatar';
import { ORG_ROLE_LABEL } from '@/components/app/org-switcher/switcher-panel';
import { QueryErrorState } from '@/components/query-error-state';
import { acceptInvitation, type PendingInvitation, useCreateOrganization, useMyInvitations, useSwitcher } from '@/hooks/api';
import { organizationKeys } from '@/hooks/api/organization-keys';
import { queryKeys } from '@/hooks/api/query-keys';
import { useFormatters } from '@/lib/format';
import { roleLabelKey } from '@/lib/member-roles';
import { useSession } from '@/services/auth-client';
import { rememberActiveProject } from '@/stores/active-project';

type Reason = 'invitation' | 'left';

export const Route = createFileRoute('/app/welcome')({
  validateSearch: (search: Record<string, unknown>): { reason?: Reason } =>
    search.reason === 'invitation' || search.reason === 'left' ? { reason: search.reason } : {},
  component: WelcomePage,
});

/**
 * Zero organizations (§5.4.3): create one, or accept a pending invitation for
 * your verified email. Three wordings: never had one; an invitation that
 * stopped working (sign-up skipped the starter org); after leaving/removal.
 */
function WelcomePage() {
  const t = useT();
  const { reason } = Route.useSearch();
  const navigate = useNavigate();
  const switcher = useSwitcher();
  const landing = switcher.data?.landing;
  // Someone who belongs to an organization has nothing to do here.
  useEffect(() => {
    if (landing) void navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug: landing.slug }, replace: true });
  }, [landing, navigate]);

  const title = reason === 'invitation' ? 'welcome.noAccess.title' : reason === 'left' ? 'welcome.left.title' : 'welcome.create.title';
  const body = reason === 'invitation' ? 'welcome.noAccess.body' : reason === 'left' ? 'welcome.left.body' : 'welcome.create.body';

  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:py-16" id="main-content" tabIndex={-1}>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <NibleafMark className="size-9" />
          <Link className="rounded-sm text-muted-foreground text-sm hover:text-foreground" search={{ tab: 'account' }} to="/app/settings">
            {t('command.accountSettings')}
          </Link>
        </div>
        <header>
          <h1 className="text-balance font-semibold text-2xl tracking-tight">{t(title)}</h1>
          <p className="mt-2 text-pretty text-muted-foreground">{t(body)}</p>
        </header>
        <PendingInvitations />
        <CreateOrganizationCard />
      </div>
    </main>
  );
}

function PendingInvitations() {
  const t = useT();
  const invitations = useMyInvitations();
  if (invitations.isPending) {
    return (
      <div aria-busy="true" className="rounded-xl border border-border bg-card p-5">
        <p className="sr-only" role="status">
          {t('common.loading')}
        </p>
        <Skeleton aria-hidden className="h-5 w-40" />
        <Skeleton aria-hidden className="mt-3 h-4 w-3/4" />
      </div>
    );
  }
  if (invitations.isError) return <QueryErrorState onRetry={() => void invitations.refetch()} retrying={invitations.isFetching} />;
  if (invitations.data.length === 0) return null;
  return (
    <section aria-labelledby="welcome-invitations" className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 font-semibold" id="welcome-invitations">
        <Mail aria-hidden className="size-4 text-muted-foreground" />
        {t('welcome.invitations.title')}
      </h2>
      <ul className="flex flex-col gap-3">
        {invitations.data.map((invitation) => (
          <InvitationCard invitation={invitation} key={invitation.id} />
        ))}
      </ul>
    </section>
  );
}

function InvitationCard({ invitation }: { invitation: PendingInvitation }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { relativeTime } = useFormatters();
  const [accepting, setAccepting] = useState(false);
  const accept = async () => {
    setAccepting(true);
    try {
      const accepted = await acceptInvitation(invitation.id);
      toast.success(t('auth.invite.acceptedToast'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: organizationKeys.me.switcher() }),
        queryClient.invalidateQueries({ queryKey: organizationKeys.me.invitations() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() }),
      ]);
      if ('projectId' in accepted.landing) {
        rememberActiveProject(accepted.landing.projectId);
        await navigate({ to: '/app/projects/$projectId', params: { projectId: accepted.landing.projectId } });
      } else await navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug: accepted.landing.organization } });
    } catch {
      toast.error(t('auth.invite.error'));
      void queryClient.invalidateQueries({ queryKey: organizationKeys.me.invitations() });
    } finally {
      setAccepting(false);
    }
  };
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center">
      <OrgAvatar className="size-9 text-xs" logo={invitation.organization.logo} name={invitation.organization.name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">
            <bdi>{invitation.organization.name}</bdi>
          </span>
          <Badge className="font-normal" variant="secondary">
            {t(ORG_ROLE_LABEL[invitation.orgRole])}
          </Badge>
        </div>
        <p className="mt-0.5 text-muted-foreground text-sm">
          {invitation.inviter ? t('welcome.invitations.from', { name: invitation.inviter.name }) : null}{' '}
          {t('welcome.invitations.expires', { when: relativeTime(invitation.expiresAt) })}
        </p>
        {invitation.grants.length > 0 ? (
          <p className="mt-1 text-muted-foreground text-xs">
            {invitation.grants.map((grant) => `${grant.projectName} (${t(roleLabelKey(grant.role))})`).join(' · ')}
          </p>
        ) : null}
      </div>
      <Button className="min-h-11 sm:min-h-0" loading={accepting} onClick={() => void accept()}>
        {t('welcome.invitations.accept')}
      </Button>
    </li>
  );
}

function CreateOrganizationCard() {
  const t = useT();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const create = useCreateOrganization();
  const inputId = useId();
  const firstName = session?.user?.name?.trim().split(/\s+/u)[0];
  const suggested = firstName ? t('welcome.create.defaultName', { name: firstName }) : t('welcome.create.defaultNameAnonymous');
  const [name, setName] = useState<string | null>(null);
  const value = name ?? suggested;
  const submit = () =>
    create.mutate(
      { name: value.trim() },
      {
        onSuccess: (organization) => {
          toast.success(t('organization.create.created', { name: organization.name }));
          void navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug: organization.slug } });
        },
        onError: () => toast.error(t('organization.create.error')),
      },
    );
  return (
    <section aria-labelledby="welcome-create" className="rounded-xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 font-semibold" id="welcome-create">
        <Building2 aria-hidden className="size-4 text-muted-foreground" />
        {t('organization.create.title')}
      </h2>
      <p className="mt-1 text-muted-foreground text-sm">{t('organization.create.description')}</p>
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) submit();
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={inputId}>{t('organization.create.name')}</Label>
          <Input dir="auto" id={inputId} maxLength={100} onChange={(event) => setName(event.target.value)} value={value} />
          {!value.trim() ? <FieldError errors={[t('organization.settings.nameRequired')]} /> : null}
        </div>
        <Button className="min-h-11 sm:min-h-0" disabled={!value.trim()} loading={create.isPending} type="submit">
          {t('organization.create.submit')}
        </Button>
      </form>
    </section>
  );
}
