import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { DataListEmpty, DataListSkeleton, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { useT } from '@nibleaf/i18n/react';
import { useQuery } from '@tanstack/react-query';
import { Crown, Link2, Mail, Search, SlidersHorizontal, UserMinus, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AdminRequired } from '@/components/organization/admin-required';
import { isAccessLoss } from '@/components/organization/use-access-loss';
import { QueryErrorState } from '@/components/query-error-state';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { type OrganizationDetail, organizationMembersQueryOptions, organizationProjectsQueryOptions } from '@/hooks/api/organization-query-options';
import { useTransferOrganizationOwnership } from '@/hooks/api/organizations';
import { useFormatters } from '@/lib/format';
import { useSession } from '@/services/auth-client';
import { useRemoveOrgMember, useResendOrgInvitation, useRevokeOrgInvitation } from '../api/mutations';
import { orgInvitationsQueryOptions, orgJoinLinksQueryOptions } from '../api/query-options';
import { filterRows, hasFilters, type MemberFilters, type MemberRow, memberRows, NO_FILTERS } from '../model/members';
import { canOnOrgMember, type OrgViewer } from '../model/permissions';
import { type OrgRole, orgRoleLabel, siteRoleLabel } from '../model/roles';
import { useReason } from './decision';
import { InvitationsList } from './invitations-list';
import { InviteDialog } from './invite-dialog';
import { CreateJoinLinkDialog, JoinLinksList } from './join-links';
import { MemberAccessSheet } from './member-access-sheet';
import { Count, PersonCell, WebsiteAccessSummary } from './person';

const ROLE_FILTERS = ['all', 'owner', 'admin', 'member'] as const;

/**
 * The organization's people (design §5.1, §6.1–§6.9), for its Owner and
 * Admins: a dense, searchable table of members (org role, websites, last
 * active, a labelled ⋯ menu), editing access in a side sheet, then pending
 * invitations and join links as sections with counts.
 */
export function OrgMembersPage({ organization }: { organization: OrganizationDetail }) {
  const t = useT();
  const reason = useReason();
  const { relativeTime, number } = useFormatters();
  const { data: session } = useSession();
  const viewer: OrgViewer = { userId: session?.user.id ?? '', orgRole: organization.orgRole as OrgRole };
  const members = useQuery(organizationMembersQueryOptions(organization.id));
  const invitations = useQuery(orgInvitationsQueryOptions(organization.id));
  const links = useQuery(orgJoinLinksQueryOptions(organization.id));
  const websitesQuery = useQuery(organizationProjectsQueryOptions(organization.id));
  const websites = useMemo(
    () => (websitesQuery.data ?? []).map((site) => ({ id: site.id, name: site.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [websitesQuery.data],
  );
  const removeMember = useRemoveOrgMember(organization.id);
  const transfer = useTransferOrganizationOwnership(organization.id);
  const revoke = useRevokeOrgInvitation(organization.id);
  const resend = useResendOrgInvitation(organization.id);

  const [filters, setFilters] = useState<MemberFilters>(NO_FILTERS);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [transferring, setTransferring] = useState<MemberRow | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const rows = useMemo(() => memberRows(members.data ?? [], session?.user.id), [members.data, session?.user.id]);
  const visible = filterRows(rows, filters);
  const filtered = hasFilters(filters);
  // Demoted while looking: the list answers 403 → the standard state, not an error (design §5.4.6).
  if (isAccessLoss(members.error)) return <AdminRequired orgSlug={organization.slug} />;

  const roleFilterItems = ROLE_FILTERS.map((role) => ({ value: role, label: role === 'all' ? t('people.filter.allRoles') : t(orgRoleLabel(role)) }));
  const websiteFilterItems = [
    { value: 'all', label: t('people.filter.allWebsites') },
    ...websites.map((site) => ({ value: site.id, label: site.name })),
  ];

  return (
    <div className="me-auto flex w-full max-w-[47.5rem] flex-col gap-10">
      <PageHeader
        actions={
          <>
            <Button onClick={() => setLinkOpen(true)} variant="outline">
              <Link2 aria-hidden className="size-4" /> {t('people.links.create')}
            </Button>
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus aria-hidden className="size-4" /> {t('people.invite.open')}
            </Button>
          </>
        }
        description={t('people.members.description', { org: organization.name })}
        title={t('nav.members')}
      />

      <section aria-labelledby="org-members-heading" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-semibold text-base" id="org-members-heading">
            {t('people.members.title')}
            {members.data ? <Count value={members.data.length} /> : null}
          </h2>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a search landmark around the filters, not a form */}
        <div aria-label={t('people.filter.label')} className="flex flex-wrap items-center gap-2" role="search">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search aria-hidden className="-translate-y-1/2 pointer-events-none absolute start-2.5 top-1/2 size-4 text-muted-foreground" />
            <Input
              aria-label={t('people.filter.search')}
              className="ps-8"
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
              placeholder={t('people.filter.search')}
              type="search"
              value={filters.query}
            />
          </div>
          <Select items={roleFilterItems} onValueChange={(role) => role && setFilters({ ...filters, role })} value={filters.role}>
            <SelectTrigger aria-label={t('people.filter.role')} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleFilterItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select items={websiteFilterItems} onValueChange={(website) => website && setFilters({ ...filters, website })} value={filters.website}>
            <SelectTrigger aria-label={t('people.filter.website')} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {websiteFilterItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  <bdi>{item.label}</bdi>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {filtered && members.data ? (
          <p aria-live="polite" className="text-muted-foreground text-xs">
            {t('people.filter.showing', { shown: number(visible.length), total: number(rows.length) })}
          </p>
        ) : null}

        <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          {members.isError && !members.data ? (
            <div className="p-4">
              <QueryErrorState onRetry={() => void members.refetch()} retrying={members.isFetching} />
            </div>
          ) : members.isPending ? (
            <DataListSkeleton loadingLabel={t('people.members.loading')} rows={4} />
          ) : visible.length === 0 ? (
            <DataListEmpty>
              <EmptyState
                action={
                  <Button onClick={() => setFilters(NO_FILTERS)} size="sm" variant="outline">
                    {t('people.filter.clear')}
                  </Button>
                }
                icon={<SlidersHorizontal />}
                title={t('people.filter.noMatch')}
              />
            </DataListEmpty>
          ) : (
            <Table aria-labelledby="org-members-heading">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="ps-4 sm:ps-5">{t('organization.members.col.person')}</TableHead>
                  <TableHead>{t('people.members.col.role')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('people.members.col.websites')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('people.members.col.lastActive')}</TableHead>
                  <TableHead className="w-12 pe-4">
                    <span className="sr-only">{t('people.members.col.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => {
                  const manage = canOnOrgMember(viewer, 'manageAccess', row.member);
                  const remove = canOnOrgMember(viewer, 'remove', row.member);
                  const transferDecision = canOnOrgMember(viewer, 'transferOwnership', row.member);
                  return (
                    <TableRow data-member={row.member.id} key={row.member.id}>
                      <TableCell className="max-w-0 ps-4 whitespace-normal sm:ps-5">
                        <PersonCell
                          extra={
                            <div className="mt-1 md:hidden">
                              <WebsiteAccessSummary access={row.access} />
                            </div>
                          }
                          image={row.member.user.image}
                          isYou={row.isYou}
                          person={row.person}
                          title={
                            manage.allowed ? (
                              <button
                                className="break-words text-start underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                                onClick={() => setEditing(row)}
                                type="button"
                              >
                                <bdi dir={row.person.secondary ? 'auto' : 'ltr'}>{row.person.primary}</bdi>
                                <span className="sr-only"> — {t('people.members.manage')}</span>
                              </button>
                            ) : undefined
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Badge className="font-normal" variant={row.member.orgRole === 'member' ? 'outline' : 'secondary'}>
                          {row.member.orgRole === 'owner' ? <Crown aria-hidden className="size-3" /> : null}
                          {t(orgRoleLabel(row.member.orgRole))}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden max-w-56 whitespace-normal md:table-cell">
                        <WebsiteAccessSummary access={row.access} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground text-sm lg:table-cell">
                        {row.member.lastActiveAt ? relativeTime(row.member.lastActiveAt) : t('people.members.neverActive')}
                      </TableCell>
                      <TableCell className="pe-4 text-end">
                        <RowActions label={t('people.members.actionsFor', { name: row.person.primary })}>
                          <RowActionsItem disabledReason={reason(manage)} icon={<Users aria-hidden />} onSelect={() => setEditing(row)}>
                            {t('people.members.manage')}
                          </RowActionsItem>
                          {viewer.orgRole === 'owner' && !row.isYou ? (
                            <RowActionsItem
                              disabledReason={reason(transferDecision)}
                              icon={<Crown aria-hidden />}
                              onSelect={() => {
                                setTransferring(row);
                                setTransferOpen(true);
                              }}
                            >
                              {t('people.members.transfer')}
                            </RowActionsItem>
                          ) : null}
                          <RowActionsItem
                            destructive
                            disabledReason={reason(remove)}
                            icon={<UserMinus aria-hidden />}
                            onSelect={() => {
                              setRemoving(row);
                              setRemoveOpen(true);
                            }}
                          >
                            {t('people.members.remove')}
                          </RowActionsItem>
                        </RowActions>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <SettingsSection
        actions={
          <Button onClick={() => setInviteOpen(true)} size="sm" variant="outline">
            <Mail aria-hidden className="size-4" /> {t('people.invite.open')}
          </Button>
        }
        description={t('people.invitations.orgHint')}
        title={
          <>
            {t('people.invitations.title')}
            {invitations.data ? <Count value={invitations.data.length} /> : null}
          </>
        }
      >
        {invitations.isPending ? (
          <DataListSkeleton loadingLabel={t('people.invitations.loading')} rows={2} />
        ) : invitations.isError && !invitations.data ? (
          <div className="p-4">
            <QueryErrorState onRetry={() => void invitations.refetch()} retrying={invitations.isFetching} />
          </div>
        ) : invitations.data?.length ? (
          <InvitationsList
            canManage
            onResend={(id) => resend.mutateAsync(id)}
            onRevoke={(id) => revoke.mutateAsync(id)}
            revokeDescription={(email) => t('people.invitations.revokeConfirm', { email })}
            revokeLabel={t('people.invitations.revoke')}
            rows={invitations.data.map((invitation) => ({
              id: invitation.id,
              email: invitation.email,
              inviterName: invitation.inviter.name || invitation.inviter.email,
              createdAt: invitation.createdAt,
              expiresAt: invitation.expiresAt,
              scope:
                invitation.orgRole === 'admin'
                  ? t('people.invitations.scopeAdmin')
                  : invitation.grants.length
                    ? `${t('people.orgRole.member')} · ${invitation.grants
                        .map((grant) => `${grant.project.name} (${t(siteRoleLabel(grant.role))})`)
                        .join(', ')}`
                    : t('people.invitations.scopeNoWebsites'),
            }))}
          />
        ) : (
          <DataListEmpty>
            <EmptyState description={t('people.invitations.emptyHint')} icon={<Mail />} title={t('people.invitations.empty')} />
          </DataListEmpty>
        )}
      </SettingsSection>

      <SettingsSection
        actions={
          <Button onClick={() => setLinkOpen(true)} size="sm" variant="outline">
            <Link2 aria-hidden className="size-4" /> {t('people.links.create')}
          </Button>
        }
        description={t('people.links.orgHint')}
        title={
          <>
            {t('people.links.title')}
            {links.data ? <Count value={links.data.length} /> : null}
          </>
        }
      >
        {links.isPending ? (
          <DataListSkeleton loadingLabel={t('people.links.loading')} rows={2} />
        ) : links.isError && !links.data ? (
          <div className="p-4">
            <QueryErrorState onRetry={() => void links.refetch()} retrying={links.isFetching} />
          </div>
        ) : (
          <JoinLinksList links={links.data ?? []} onCreate={() => setLinkOpen(true)} scope={{ kind: 'org', organizationId: organization.id }} />
        )}
      </SettingsSection>

      <InviteDialog
        onOpenChange={setInviteOpen}
        open={inviteOpen}
        organizationId={organization.id}
        organizationName={organization.name}
        websites={websites}
      />
      <CreateJoinLinkDialog onOpenChange={setLinkOpen} open={linkOpen} scope={{ kind: 'org', organizationId: organization.id }} websites={websites} />
      <MemberAccessSheet onOpenChange={(open) => !open && setEditing(null)} organizationId={organization.id} row={editing} websites={websites} />
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('people.members.remove')}
        description={removing ? t('people.members.removeConfirm', { name: removing.person.primary, org: organization.name }) : undefined}
        destructive
        errorMessage={(error) => friendlyErrorMessage(t, error, 'people.members.removeFailed')}
        fallbackErrorMessage={t('people.members.removeFailed')}
        onConfirm={async () => {
          if (!removing) return;
          await removeMember.mutateAsync(removing.member.id);
          toast.success(t('people.members.removed', { name: removing.person.primary }));
        }}
        onOpenChange={setRemoveOpen}
        open={removeOpen}
        pendingLabel={t('people.members.removing')}
        title={t('people.members.removeTitle', { name: removing?.person.primary ?? '' })}
      />
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('people.members.transfer')}
        confirmText={organization.name}
        confirmTextLabel={t('people.members.transferType', { org: organization.name })}
        confirmTextMismatch={t('people.members.transferMismatch')}
        description={transferring ? t('people.members.transferConfirm', { name: transferring.person.primary }) : undefined}
        errorMessage={(error) => friendlyErrorMessage(t, error, 'people.members.transferFailed')}
        fallbackErrorMessage={t('people.members.transferFailed')}
        onConfirm={async () => {
          if (!transferring) return;
          await transfer.mutateAsync(transferring.member.id);
          toast.success(t('people.members.transferred', { name: transferring.person.primary }));
        }}
        onOpenChange={setTransferOpen}
        open={transferOpen}
        pendingLabel={t('people.members.transferring')}
        title={t('people.members.transferTitle')}
      />
    </div>
  );
}
