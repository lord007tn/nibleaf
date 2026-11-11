import type { AnalyticsRange } from '@nibleaf/validators';
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { organizationKeys } from '@/hooks/api/organization-keys';
import { useSessionMutation, useSessionQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { mutateData } from './client-helpers';
import {
  myInvitationsQueryOptions,
  myPreferencesQueryOptions,
  type OrganizationDetail,
  organizationAnalyticsQueryOptions,
  organizationBySlugQueryOptions,
  organizationMembersQueryOptions,
  organizationProjectsQueryOptions,
  organizationSwitcherProjectsQueryOptions,
  organizationUsageQueryOptions,
  type PersonalNotificationKey,
  type PersonalPreferences,
  switcherQueryOptions,
} from './organization-query-options';
import { queryKeys } from './query-keys';

export * from './organization-query-options';

const subscribeToHydration = () => () => undefined;

export const useSwitcher = () => useQuery(switcherQueryOptions());
/** The switcher's entry for a website's organization: name, slug and the caller's org role. */
export const useOrganizationOfProject = (organizationId: string | undefined) => {
  const switcher = useSwitcher();
  // Same tree as the server until hydration, so cached data never causes a mismatch.
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  return {
    organization: hydrated && organizationId ? switcher.data?.organizations.find((org) => org.id === organizationId) : undefined,
    isPending: switcher.isPending,
  };
};
export const useOrganizationBySlug = (slug: string | undefined) => useQuery(organizationBySlugQueryOptions(slug));
export const useOrganizationSwitcherProjects = (organizationId: string | undefined) =>
  useQuery(organizationSwitcherProjectsQueryOptions(organizationId));
export const useOrganizationProjects = (organizationId: string | undefined, options?: { pollWhilePublishing?: boolean }) =>
  useQuery({
    ...organizationProjectsQueryOptions(organizationId),
    // Same rule as the sites list: poll only while a publish is queued or running.
    refetchInterval: options?.pollWhilePublishing ? (query) => (query.state.data?.some((site) => site.publishing) ? 3000 : false) : undefined,
  });
export const useOrganizationMembers = (organizationId: string | undefined) => useQuery(organizationMembersQueryOptions(organizationId));
export const useOrganizationUsage = (organizationId: string | undefined) => useQuery(organizationUsageQueryOptions(organizationId));
export const useOrganizationAnalytics = (organizationId: string | undefined, range: AnalyticsRange, timezone: string) =>
  useQuery(organizationAnalyticsQueryOptions(organizationId, range, timezone));
export const useMyInvitations = (enabled = true) => useQuery({ ...myInvitationsQueryOptions(), enabled });
export const useMyPreferences = () => useQuery(myPreferencesQueryOptions());

/** Everything that lists organizations or their websites. */
const invalidateOrganizations = (qc: ReturnType<typeof useSessionQueryClient>) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: organizationKeys.me.switcher() }),
    qc.invalidateQueries({ queryKey: organizationKeys.organizations.all() }),
    qc.invalidateQueries({ queryKey: queryKeys.projects.all() }),
  ]);

/**
 * After leaving or deleting an org: refresh the lists, but only mark the org's
 * own reads stale. Refetching them now would 404 and trigger the "you lost
 * access" redirect while the caller is already navigating away on purpose.
 */
const forgetOrganization = (qc: ReturnType<typeof useSessionQueryClient>) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: organizationKeys.me.switcher() }),
    qc.invalidateQueries({ queryKey: queryKeys.projects.all() }),
    qc.invalidateQueries({ queryKey: organizationKeys.organizations.all(), refetchType: 'none' }),
  ]);

export const useCreateOrganization = () => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (body: { name: string }) =>
      mutateData<OrganizationDetail>(await api.app.organizations.$post({ json: body }), 'Could not create the organization.'),
    onSuccess: () => invalidateOrganizations(qc),
  });
};

export const useUpdateOrganization = (organizationId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (body: { name?: string; slug?: string; logo?: string | null; sendInvitationEmails?: boolean }) =>
      mutateData<OrganizationDetail>(
        await api.app.organizations[':organizationId'].$patch({ param: { organizationId }, json: body }),
        'Could not save the organization.',
      ),
    onSuccess: (organization) => {
      qc.setQueryData(organizationKeys.organizations.detail(organizationId), (previous: OrganizationDetail | undefined) => ({
        ...previous,
        ...organization,
      }));
      return invalidateOrganizations(qc);
    },
  });
};

export const useLeaveOrganization = (organizationId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async () =>
      mutateData(await api.app.organizations[':organizationId'].leave.$post({ param: { organizationId } }), 'Could not leave the organization.'),
    onSuccess: () => forgetOrganization(qc),
  });
};

export const useTransferOrganizationOwnership = (organizationId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (memberId: string) =>
      mutateData(
        await api.app.organizations[':organizationId']['transfer-ownership'].$post({ param: { organizationId }, json: { memberId } }),
        'Could not transfer ownership.',
      ),
    onSuccess: () => invalidateOrganizations(qc),
  });
};

export const useDeleteOrganization = (organizationId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (confirmName: string) =>
      mutateData(
        await api.app.organizations[':organizationId'].$delete({ param: { organizationId }, json: { confirmName } }),
        'Could not delete the organization.',
      ),
    onSuccess: () => forgetOrganization(qc),
  });
};

/** Records the org (and website) the person opened: landing org and switcher "Recent". */
export const useRecordVisit = () => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (body: { organizationId: string } | { projectId: string }) =>
      mutateData(await api.app.me['last-organization'].$put({ json: body }), 'Could not remember the last organization.'),
    // Recent websites and order change; refresh quietly the next time the switcher opens.
    onSuccess: () => qc.invalidateQueries({ queryKey: organizationKeys.me.switcher(), refetchType: 'none' }),
  });
};

export const useUpdatePreferences = () => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (notifications: Partial<Record<PersonalNotificationKey, boolean>>) =>
      mutateData<PersonalPreferences>(await api.app.me.preferences.$put({ json: { notifications } }), 'Could not save your preferences.'),
    onMutate: async (notifications) => {
      await qc.cancelQueries({ queryKey: organizationKeys.me.preferences() });
      const previous = qc.getQueryData<PersonalPreferences>(organizationKeys.me.preferences());
      if (previous) qc.setQueryData(organizationKeys.me.preferences(), { notifications: { ...previous.notifications, ...notifications } });
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(organizationKeys.me.preferences(), context.previous);
    },
    onSuccess: (data) => qc.setQueryData(organizationKeys.me.preferences(), data),
  });
};
