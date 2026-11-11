import { createFileRoute } from '@tanstack/react-router';
import { AdminRequired } from '@/components/organization/admin-required';
import { isOrgAdmin, useCurrentOrganization } from '@/components/organization/organization-context';
import { prefetchOrgPeople } from '@/features/people/api/prefetch';
import { OrgMembersPage } from '@/features/people/components/org-members-page';
import { organizationKeys } from '@/hooks/api/organization-keys';

export const Route = createFileRoute('/app/o/$orgSlug/members')({
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    const organization = queryClient.getQueryData<{ id: string; orgRole: string }>(organizationKeys.organizations.bySlug(orgSlug));
    if (organization && organization.orgRole !== 'member') prefetchOrgPeople(queryClient, organization.id);
  },
  component: MembersRoute,
});

/** Org Members (design §5.1): Owner and Admins manage people; Members see the standard "Administrator access required" state. */
function MembersRoute() {
  const organization = useCurrentOrganization();
  if (!isOrgAdmin(organization)) return <AdminRequired orgSlug={organization.slug} />;
  return <OrgMembersPage organization={organization} />;
}
