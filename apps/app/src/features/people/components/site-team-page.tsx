import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { DataList, DataListEmpty, DataListItem, DataListSkeleton, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { useT } from '@nibleaf/i18n/react';
import type { MemberRole } from '@nibleaf/shared/constants';
import type { OrgRole } from '@nibleaf/shared/rbac';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Crown, Link2, UserMinus, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { QueryErrorState } from '@/components/query-error-state';
import { useSiteAccess } from '@/features/site-access/api/hooks';
import { decide } from '@/features/site-access/model/access';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import type { SwitcherOrganization } from '@/hooks/api/organization-query-options';
import { useProjectMembers } from '@/hooks/api/queries';
import { useSession } from '@/services/auth-client';
import { useChangeSiteRole, useRemoveFromSite, useResendSiteInvitation, useRevokeSiteInvitation } from '../api/mutations';
import { siteJoinLinksQueryOptions } from '../api/query-options';
import { personDisplay } from '../model/person';
import { assignableSiteRoles, type EffectiveSiteRole, isOrgAdminRole, isSiteRole, type SiteRole, siteRoleLabel } from '../model/roles';
import { AddPeopleDialog } from './add-people-dialog';
import { useReason } from './decision';
import { InvitationsList } from './invitations-list';
import { CreateJoinLinkDialog, JoinLinksList } from './join-links';
import { Count, PersonCell } from './person';
import { SiteRoleSelect } from './role-options';

/**
 * A website's Team page (design §5.3): who can open this website. People come
 * "from the organization" (its Owner and Admins open every website) or have
 * "website access" (a grant here). Site Admins add people, change roles here
 * and see this website's part of pending invitations and its join links.
 * Organization concepts (org roles, the whole roster, billing) live on the
 * org's Members page, linked from here for org Owner/Admins.
 */
export function SiteTeamPage({
  projectId,
  siteName,
  organization,
}: {
  projectId: string;
  siteName: string;
  organization: SwitcherOrganization | undefined;
}) {
  const t = useT();
  const reason = useReason();
  const { data: session } = useSession();
  const team = useProjectMembers(projectId);
  const me = team.data?.members.find((member) => member.user.id === session?.user.id);
  // The shared site-access model (one policy for every website screen); it
  // reuses this page's members query, so no extra request.
  const access = useSiteAccess(projectId);
  const sessionUserId = session?.user.id ?? '';
  const canManage = decide(access, { type: 'site.members.manage' }).kind === 'allowed';
  const links = useQuery({ ...siteJoinLinksQueryOptions(projectId), enabled: canManage });
  const changeRole = useChangeSiteRole(projectId);
  const removeFromSite = useRemoveFromSite(projectId);
  const revoke = useRevokeSiteInvitation(projectId);
  const resend = useResendSiteInvitation(projectId);
  const [addOpen, setAddOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [promoting, setPromoting] = useState<{ id: string; name: string } | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const promote = (target: { id: string; name: string }) => {
    setPromoting(target);
    setPromoteOpen(true);
  };
  const applyRole = (memberId: string, name: string, role: SiteRole) =>
    changeRole.mutateAsync({ memberId, role }).then(
      () => {
        toast.success(t('people.site.roleChanged', { name, role: t(siteRoleLabel(role)) }));
      },
      (error: unknown) => {
        toast.error(t('people.site.roleChangeFailed', { name }), { description: friendlyErrorMessage(t, error, 'settings.members.toast.roleError') });
      },
    );
  const orgName = organization?.name ?? '';
  const allowed = access.status === 'ready' ? assignableSiteRoles(access.role as EffectiveSiteRole) : [];

  if (team.isError && !team.data) return <QueryErrorState onRetry={() => void team.refetch()} retrying={team.isFetching} />;

  const members = team.data?.members ?? [];
  const fromOrganization = members.filter((member) => member.viaOrganization).sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0));
  const withAccess = members
    .filter((member) => !member.viaOrganization)
    .sort((a, b) => personDisplay(a.user).primary.localeCompare(personDisplay(b.user).primary));
  const invitations = team.data?.invitations ?? [];
  const orgMembersLink =
    organization && isOrgAdminRole(organization.orgRole) ? (
      <Button nativeButton={false} render={<Link params={{ orgSlug: organization.slug }} to="/app/o/$orgSlug/members" />} variant="ghost">
        {t('people.site.manageInOrg', { org: orgName })} <ArrowUpRight aria-hidden className="size-4 rtl:-scale-x-100" />
      </Button>
    ) : null;

  return (
    <div className="me-auto flex w-full max-w-[47.5rem] flex-col gap-10">
      <PageHeader
        actions={
          <>
            {orgMembersLink}
            {canManage ? (
              <Button onClick={() => setAddOpen(true)}>
                <UserPlus aria-hidden className="size-4" /> {t('people.site.add')}
              </Button>
            ) : null}
          </>
        }
        description={t('people.site.description', { site: siteName, org: orgName })}
        title={t('people.site.title')}
      />
      {me && !canManage ? <Callout tone="neutral">{t('people.site.readOnly', { role: t(siteRoleLabel(me.role)) })}</Callout> : null}

      <SettingsSection
        description={t('people.site.fromOrgHint', { org: orgName })}
        title={
          <>
            {t('people.site.fromOrg')}
            {team.data ? <Count value={fromOrganization.length} /> : null}
          </>
        }
      >
        {team.isPending ? (
          <DataListSkeleton loadingLabel={t('people.members.loading')} rows={1} />
        ) : (
          <DataList aria-label={t('people.site.fromOrg')}>
            {fromOrganization.map((member) => {
              const person = personDisplay(member.user);
              return (
                <DataListItem
                  key={member.id}
                  title={<PersonCell image={member.user.image} isYou={member.user.id === session?.user.id} person={person} />}
                  trailing={
                    <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-muted-foreground text-sm">
                      <Badge className="font-normal" variant="secondary">
                        {member.role === 'owner' ? <Crown aria-hidden className="size-3" /> : null}
                        {t(siteRoleLabel(member.role))}
                      </Badge>
                      {t('settings.members.viaOrganization')}
                    </span>
                  }
                />
              );
            })}
          </DataList>
        )}
      </SettingsSection>

      <SettingsSection
        description={t('people.site.accessHint')}
        title={
          <>
            {t('people.site.access')}
            {team.data ? <Count value={withAccess.length} /> : null}
          </>
        }
      >
        {team.isPending ? (
          <DataListSkeleton loadingLabel={t('people.members.loading')} rows={2} />
        ) : withAccess.length ? (
          <DataList aria-label={t('people.site.access')}>
            {withAccess.map((member) => {
              const person = personDisplay(member.user);
              const target = {
                userId: member.user.id,
                role: member.role as MemberRole,
                orgRole: (member.orgRole ?? null) as OrgRole | null,
                viaOrganization: member.viaOrganization,
              };
              const change = decide(access, { type: 'site.member.changeRole', member: target, sessionUserId });
              const remove = decide(access, { type: 'site.member.remove', member: target, sessionUserId });
              return (
                <DataListItem
                  key={member.id}
                  title={<PersonCell image={member.user.image} isYou={member.user.id === session?.user.id} person={person} />}
                  trailing={
                    <>
                      {change.kind === 'allowed' && isSiteRole(member.role) ? (
                        <SiteRoleSelect
                          allowed={allowed}
                          label={t('people.site.roleFor', { name: person.primary })}
                          onChange={(role) =>
                            // Admin can change settings, domains and the team: ask first (WORKSPACE-26).
                            role === 'admin' ? promote({ id: member.id, name: person.primary }) : applyRole(member.id, person.primary, role)
                          }
                          value={member.role}
                        />
                      ) : (
                        <Badge className="font-normal" variant="outline">
                          {t(siteRoleLabel(member.role))}
                        </Badge>
                      )}
                      {canManage ? (
                        <RowActions label={t('people.members.actionsFor', { name: person.primary })}>
                          <RowActionsItem
                            destructive
                            disabledReason={reason(remove)}
                            icon={<UserMinus aria-hidden />}
                            onSelect={() => {
                              setRemoving({ id: member.id, name: person.primary });
                              setRemoveOpen(true);
                            }}
                          >
                            {t('people.site.remove')}
                          </RowActionsItem>
                        </RowActions>
                      ) : null}
                    </>
                  }
                />
              );
            })}
          </DataList>
        ) : (
          <DataListEmpty>
            <EmptyState
              action={
                canManage ? (
                  <Button onClick={() => setAddOpen(true)} size="sm" variant="outline">
                    <UserPlus aria-hidden className="size-4" /> {t('people.site.add')}
                  </Button>
                ) : undefined
              }
              description={t('people.site.accessEmptyHint', { org: orgName })}
              icon={<Users />}
              title={t('people.site.accessEmpty')}
            />
          </DataListEmpty>
        )}
      </SettingsSection>

      {/* Only when there is something to show: never a section you open to see nothing (defect 3). */}
      {invitations.length ? (
        <SettingsSection
          description={t('people.site.invitationsHint')}
          title={
            <>
              {t('people.invitations.title')}
              <Count value={invitations.length} />
            </>
          }
        >
          <InvitationsList
            canManage={canManage}
            onResend={(id) => resend.mutateAsync(id)}
            onRevoke={(id) => revoke.mutateAsync(id)}
            revokeDescription={(email) => t('people.site.revokeConfirm', { email, site: siteName })}
            revokeLabel={t('people.site.revoke')}
            rows={invitations.map((invitation) => ({
              id: invitation.id,
              email: invitation.email,
              inviterName: invitation.inviter?.name || invitation.inviter?.email || null,
              createdAt: invitation.createdAt,
              expiresAt: invitation.expiresAt,
              scope: t('people.site.invitedAs', { role: t(siteRoleLabel(invitation.role)) }),
            }))}
          />
        </SettingsSection>
      ) : null}

      {canManage ? (
        <SettingsSection
          actions={
            <Button onClick={() => setLinkOpen(true)} size="sm" variant="outline">
              <Link2 aria-hidden className="size-4" /> {t('people.links.create')}
            </Button>
          }
          description={t('people.links.siteHint', { site: siteName })}
          title={
            <>
              {t('people.links.title')}
              {links.data ? <Count value={links.data.length} /> : null}
            </>
          }
        >
          {links.isPending ? (
            <DataListSkeleton loadingLabel={t('people.links.loading')} rows={1} />
          ) : links.isError && !links.data ? (
            <div className="p-4">
              <QueryErrorState onRetry={() => void links.refetch()} retrying={links.isFetching} />
            </div>
          ) : (
            <JoinLinksList links={links.data ?? []} onCreate={() => setLinkOpen(true)} scope={{ kind: 'site', projectId }} />
          )}
        </SettingsSection>
      ) : null}

      {canManage ? (
        <>
          <AddPeopleDialog allowedRoles={allowed} onOpenChange={setAddOpen} open={addOpen} projectId={projectId} siteName={siteName} />
          <CreateJoinLinkDialog
            allowedRoles={allowed}
            onOpenChange={setLinkOpen}
            open={linkOpen}
            scope={{ kind: 'site', projectId }}
            websites={[{ id: projectId, name: siteName }]}
          />
          <ActionDialog
            cancelLabel={t('common.cancel')}
            confirmLabel={t('people.site.promote')}
            description={promoting ? t('people.site.promoteConfirm', { name: promoting.name, site: siteName }) : undefined}
            fallbackErrorMessage={t('settings.members.toast.roleError')}
            onConfirm={async () => {
              if (promoting) await applyRole(promoting.id, promoting.name, 'admin');
            }}
            onOpenChange={setPromoteOpen}
            open={promoteOpen}
            title={t('people.site.promoteTitle', { name: promoting?.name ?? '' })}
          />
          <ActionDialog
            cancelLabel={t('common.cancel')}
            confirmLabel={t('people.site.remove')}
            description={removing ? t('people.site.removeConfirm', { name: removing.name, site: siteName, org: orgName }) : undefined}
            destructive
            errorMessage={(error) => friendlyErrorMessage(t, error, 'people.members.removeFailed')}
            fallbackErrorMessage={t('people.members.removeFailed')}
            onConfirm={async () => {
              if (!removing) return;
              await removeFromSite.mutateAsync(removing.id);
              toast.success(t('people.site.removed', { name: removing.name, site: siteName }));
            }}
            onOpenChange={setRemoveOpen}
            open={removeOpen}
            pendingLabel={t('people.members.removing')}
            title={t('people.site.removeTitle', { name: removing?.name ?? '' })}
          />
        </>
      ) : null}
    </div>
  );
}
