import { createContext, useContext } from 'react';
import type { OrganizationDetail } from '@/hooks/api/organization-query-options';

/** The organization of the `/app/o/$orgSlug` page in view, resolved by its route. */
export const OrganizationContext = createContext<OrganizationDetail | null>(null);

export const useCurrentOrganization = () => {
  const organization = useContext(OrganizationContext);
  if (!organization) throw new Error('useCurrentOrganization must be used inside an organization route');
  return organization;
};

export const isOrgAdmin = (organization: Pick<OrganizationDetail, 'orgRole'>) => organization.orgRole === 'owner' || organization.orgRole === 'admin';
