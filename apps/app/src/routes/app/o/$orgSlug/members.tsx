import { Avatar, AvatarFallback, AvatarImage } from '@nibleaf/design-system/components/ui/avatar';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute } from '@tanstack/react-router';
import { UserPlus } from 'lucide-react';
import { useId } from 'react';
import { initials } from '@/components/app/org-switcher/switcher-model';
import { ORG_ROLE_LABEL } from '@/components/app/org-switcher/switcher-panel';
import { PageHeader } from '@/components/app/page-header';
import { AdminRequired } from '@/components/organization/admin-required';
import { isOrgAdmin, useCurrentOrganization } from '@/components/organization/organization-context';
import { isAccessLoss } from '@/components/organization/use-access-loss';
import { QueryErrorState } from '@/components/query-error-state';
import { type OrganizationMember, useOrganizationMembers } from '@/hooks/api';
import { organizationMembersQueryOptions } from '@/hooks/api/organization-query-options';
import { queryKeys } from '@/hooks/api/query-keys';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { useFormatters } from '@/lib/format';

export const Route = createFileRoute('/app/o/$orgSlug/members')({
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    const organization = queryClient.getQueryData<{ id: string; orgRole: string }>(queryKeys.organizations.bySlug(orgSlug));
    if (organization && organization.orgRole !== 'member') prefetchRouteData(queryClient, organizationMembersQueryOptions(organization.id));
  },
  component: MembersPage,
});

const SKELETON_ROWS = ['a', 'b', 'c', 'd'];

/**
 * Org Members, read-only in this release: who belongs, their org role and how
 * many websites they can open. Inviting and changing access come next (design
 * §11, PR 3); meanwhile each website's Settings → Members manages its access.
 */
function MembersPage() {
  const organization = useCurrentOrganization();
  const t = useT();
  const admin = isOrgAdmin(organization);
  const members = useOrganizationMembers(admin ? organization.id : undefined);
  const noticeId = useId();
  if (!admin || isAccessLoss(members.error)) return <AdminRequired orgSlug={organization.slug} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        actions={
          // Placeholder until invitations ship: visible, explained, not clickable.
          <Button aria-describedby={noticeId} disabled title={t('organization.members.inviteSoon')}>
            <UserPlus className="size-4" /> {t('organization.members.invite')}
          </Button>
        }
        description={t('organization.members.subtitle', { org: organization.name })}
        title={t('nav.members')}
      />
      <p className="rounded-lg border border-border bg-muted/30 p-3 text-muted-foreground text-sm" id={noticeId}>
        {t('organization.members.readOnlyNotice')}
      </p>
      {members.isError && !members.data ? (
        <QueryErrorState onRetry={() => void members.refetch()} retrying={members.isFetching} />
      ) : (
        <div aria-busy={members.isPending} className="rounded-xl border border-border bg-card">
          {members.isPending ? (
            <p className="sr-only" role="status">
              {t('common.loading')}
            </p>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('organization.members.col.person')}</TableHead>
                <TableHead>{t('organization.members.col.role')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('organization.members.col.access')}</TableHead>
                <TableHead className="hidden text-end md:table-cell">{t('organization.members.col.joined')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.isPending
                ? SKELETON_ROWS.map((row) => (
                    <TableRow aria-hidden key={row}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Skeleton className="size-8 rounded-full" />
                          <div className="flex flex-1 flex-col gap-1.5">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-3 w-44" />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Skeleton className="ms-auto h-4 w-20" />
                      </TableCell>
                    </TableRow>
                  ))
                : (members.data ?? []).map((member) => <MemberRow key={member.id} member={member} />)}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function MemberRow({ member }: { member: OrganizationMember }) {
  const t = useT();
  const { date, count } = useFormatters();
  // "All websites" for Owner/Admin (implicit access), "N websites" for Members.
  const access =
    member.orgRole === 'member'
      ? member.projectGrants.length === 0
        ? t('organization.members.noWebsites')
        : t('organization.members.websites', count(member.projectGrants.length))
      : t('organization.members.allWebsites');
  return (
    <TableRow data-member={member.id}>
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-8">
            {member.user.image ? <AvatarImage alt="" src={member.user.image} /> : null}
            <AvatarFallback className="text-xs">{initials(member.user.name || member.user.email)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate font-medium">
              <bdi>{member.user.name || member.user.email}</bdi>
            </div>
            <div className="truncate text-muted-foreground text-xs">
              <bdi dir="ltr">{member.user.email}</bdi>
            </div>
            <div className="text-muted-foreground text-xs sm:hidden">{access}</div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge className="font-normal" variant={member.orgRole === 'member' ? 'outline' : 'secondary'}>
          {t(ORG_ROLE_LABEL[member.orgRole])}
        </Badge>
      </TableCell>
      <TableCell className="hidden text-sm sm:table-cell" title={member.projectGrants.map((grant) => grant.project.name).join(', ') || undefined}>
        {access}
      </TableCell>
      <TableCell className="hidden text-end text-muted-foreground text-sm md:table-cell">{date(member.createdAt)}</TableCell>
    </TableRow>
  );
}
