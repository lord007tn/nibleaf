import type { AnalyticsRange } from '@nibleaf/validators';
import { queryOptions, skipToken } from '@tanstack/react-query';
import { organizationKeys } from '@/hooks/api/organization-keys';
import { api } from '@/services/api';
import { getData } from './client-helpers';
import type { Project } from './types';

/*
 * Organization and "me" query factories. Route loaders import this module, and
 * loaders ship in every page's first load (DATA_LOADING.md), so it stays as
 * light as query-options.ts: no i18n, no components, no validators runtime.
 */

export type OrgRole = 'owner' | 'admin' | 'member';
export type SiteRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface SwitcherOrganization {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
  orgRole: OrgRole;
  canCreateWebsite: boolean;
  /** Websites the signed-in person can open in this organization. */
  websiteCount: number;
}

export interface SwitcherWebsite {
  id: string;
  name: string;
  icon: string | null;
  /** Primary custom domain, else the default subdomain. */
  domain: string | null;
  live: boolean;
}

export interface RecentWebsite extends SwitcherWebsite {
  organization: { id: string; slug: string; name: string };
}

export interface SwitcherData {
  organizations: SwitcherOrganization[];
  recent: RecentWebsite[];
  /** Where `/app` lands (§5.4.3); null when the person belongs to no organization. */
  landing: { id: string; slug: string } | null;
}

export interface OrganizationDetail {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
  orgRole: OrgRole;
  canCreateWebsite: boolean;
  sendInvitationEmails?: boolean;
  /** Owner first, then Admins: who a Member without websites can ask. */
  administrators?: Array<{ name: string }>;
}

export interface OrganizationWebsite extends Project {
  role: SiteRole;
  domain: string | null;
}

export interface OrganizationMember {
  id: string;
  userId: string;
  orgRole: OrgRole;
  createdAt: string;
  /** When they last used Nibleaf (their newest session); null if never signed in. */
  lastActiveAt: string | null;
  user: { id: string; name: string; email: string; image: string | null };
  projectGrants: Array<{ projectId: string; role: string; project: { id: string; name: string } }>;
}

export interface PendingInvitation {
  id: string;
  organization: { name: string; logo: string | null };
  inviter: { name: string } | null;
  orgRole: OrgRole;
  grants: Array<{ projectName: string; role: string }>;
  expiresAt: string;
}

export const PERSONAL_NOTIFICATION_KEYS = [
  'security_login',
  'project_deploy',
  'project_deploy_failed',
  'member_joined',
  'project_new',
  'workspace_weekly',
  'workspace_plan',
] as const;
export type PersonalNotificationKey = (typeof PERSONAL_NOTIFICATION_KEYS)[number];
export interface PersonalPreferences {
  notifications: Record<PersonalNotificationKey, boolean>;
}

/** Orgs, recent websites and the landing org for the switcher and `/app`. */
export const switcherQueryOptions = () =>
  queryOptions({
    queryKey: organizationKeys.me.switcher(),
    queryFn: async () => getData<SwitcherData>(await api.app.me.switcher.$get(), 'organizations'),
  });

export const organizationBySlugQueryOptions = (slug: string | undefined) =>
  queryOptions({
    queryKey: organizationKeys.organizations.bySlug(slug ?? ''),
    queryFn: slug
      ? async () => getData<OrganizationDetail>(await api.app.organizations['by-slug'][':slug'].$get({ param: { slug } }), 'organization')
      : skipToken,
  });

/** The compact website list the switcher's right pane shows (only websites you can open). */
export const organizationSwitcherProjectsQueryOptions = (organizationId: string | undefined) =>
  queryOptions({
    queryKey: organizationKeys.organizations.projects(organizationId ?? '', 'switcher'),
    queryFn: organizationId
      ? async () =>
          getData<SwitcherWebsite[]>(
            await api.app.organizations[':organizationId'].projects.$get({ param: { organizationId }, query: { view: 'switcher' } }),
            'websites',
          )
      : skipToken,
  });

/** The org Websites page: cards with status, last publish and your role. */
export const organizationProjectsQueryOptions = (organizationId: string | undefined) =>
  queryOptions({
    queryKey: organizationKeys.organizations.projects(organizationId ?? '', 'list'),
    queryFn: organizationId
      ? async () =>
          getData<OrganizationWebsite[]>(
            await api.app.organizations[':organizationId'].projects.$get({ param: { organizationId }, query: {} }),
            'websites',
          )
      : skipToken,
  });

export const organizationMembersQueryOptions = (organizationId: string | undefined) =>
  queryOptions({
    queryKey: organizationKeys.organizations.members(organizationId ?? ''),
    queryFn: organizationId
      ? async () =>
          getData<OrganizationMember[]>(await api.app.organizations[':organizationId'].members.$get({ param: { organizationId } }), 'members')
      : skipToken,
    // Joins and accepted invitations happen elsewhere: keep the list current (#421).
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

export const organizationUsageQueryOptions = (organizationId: string | undefined) =>
  queryOptions({
    queryKey: organizationKeys.organizations.usage(organizationId ?? ''),
    queryFn: organizationId
      ? async () => getData(await api.app.organizations[':organizationId'].usage.$get({ param: { organizationId } }), 'usage')
      : skipToken,
  });

export const organizationAnalyticsQueryOptions = (organizationId: string | undefined, range: AnalyticsRange, timezone: string) =>
  queryOptions({
    queryKey: organizationKeys.organizations.analytics(organizationId ?? '', range, timezone),
    queryFn: organizationId
      ? async () =>
          getData(
            await api.app.organizations[':organizationId'].analytics.$get({ param: { organizationId }, query: { range, timezone } }),
            'organization analytics',
          )
      : skipToken,
  });

export const myInvitationsQueryOptions = () =>
  queryOptions({
    queryKey: organizationKeys.me.invitations(),
    queryFn: async () => getData<PendingInvitation[]>(await api.app.me.invitations.$get(), 'invitations'),
  });

export const myPreferencesQueryOptions = () =>
  queryOptions({
    queryKey: organizationKeys.me.preferences(),
    queryFn: async () => getData<PersonalPreferences>(await api.app.me.preferences.$get(), 'preferences'),
  });
