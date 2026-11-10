import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { ApiResponseError, mutateData } from '@/hooks/api/client-helpers';
import type { OrganizationMember } from '@/hooks/api/organization-query-options';
import type { useProjectMembers } from '@/hooks/api/queries';
import { useSessionMutation, useSessionQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import type { SiteRole } from '../model/roles';
import { peopleKeys } from './keys';
import type { JoinLinkRecord, OrgInvitation } from './query-options';

/*
 * People mutations (operations/ui-overhaul.md §8.2). Each one states its class:
 *
 * - optimistic: the outcome is predictable and touches only the row it names
 *   (remove, revoke, delete, a website role). The row changes at once and comes
 *   back if the server refuses; the list is refetched when it settles.
 * - server-confirmed: the server creates ids, sends email or can refuse for
 *   reasons the client can't see (invite, org role, resend, links).
 * - form save: the access sheet, from `mutateAsync` in its submit.
 *
 * All of them are session-scoped (useSessionMutation / useSessionQueryClient):
 * a late result for one account never writes into another account's cache.
 *
 * Every mutation reports its own error where it was started (a dialog, the
 * sheet, a toast that names the person), so none sets `meta.errorMessage`
 * (the global toast).
 */

export type SiteTeam = NonNullable<ReturnType<typeof useProjectMembers>['data']>;
type Grant = { projectId: string; role: SiteRole };

/** Optimistically change one cached list; returns the rollback. */
async function patchCache<T>(qc: QueryClient, key: QueryKey, change: (previous: T) => T) {
  await qc.cancelQueries({ queryKey: key });
  const previous = qc.getQueryData<T>(key);
  if (previous !== undefined) qc.setQueryData<T>(key, change(previous));
  return () => qc.setQueryData(key, previous);
}

const refreshOrgPeople = (qc: QueryClient, organizationId: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: peopleKeys.orgMembers(organizationId) }),
    qc.invalidateQueries({ queryKey: peopleKeys.orgInvitations(organizationId) }),
    qc.invalidateQueries({ queryKey: peopleKeys.orgJoinLinks(organizationId) }),
    // Each website's Team page shows the same people.
    qc.invalidateQueries({ queryKey: ['members'] }),
  ]);

// ─── Organization ───────────────────────────────────────────────────────────

export interface InviteResult {
  invitations: Array<{ id: string; email: string }>;
  existingMembers: Array<{ userId: string; email: string; changed: boolean }>;
  emailed: boolean;
}

/** server-confirmed: creates invitations (ids), may add grants to existing members directly. */
export const useInviteToOrganization = (organizationId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (body: { emails: string[]; orgRole: 'admin' | 'member'; grants: Grant[] }) =>
      mutateData<InviteResult>(
        await api.app.organizations[':organizationId'].invitations.$post({ param: { organizationId }, json: body }),
        'Could not send the invitations.',
      ),
    onSettled: () => refreshOrgPeople(qc, organizationId),
  });
};

/** server-confirmed: Member ↔ Admin; a demotion carries the websites they keep. Also revokes the person's links beyond their new role. */
export const useChangeOrgRole = (organizationId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async ({ memberId, orgRole, grants }: { memberId: string; orgRole: 'admin' | 'member'; grants?: Grant[] }) =>
      mutateData(
        await api.app.organizations[':organizationId'].members[':memberId'].$patch({
          param: { organizationId, memberId },
          json: { orgRole, ...(grants ? { grants } : {}) },
        }),
        'Could not change the role.',
      ),
    onSettled: () => refreshOrgPeople(qc, organizationId),
  });
};

/** form save: replaces a Member's website set (none is allowed). */
export const useReplaceMemberAccess = (organizationId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async ({ memberId, grants }: { memberId: string; grants: Grant[] }) =>
      mutateData(
        await api.app.organizations[':organizationId'].members[':memberId'].access.$put({ param: { organizationId, memberId }, json: { grants } }),
        'Could not save access.',
      ),
    onSettled: () => refreshOrgPeople(qc, organizationId),
  });
};

/** optimistic: the row leaves the list at once and comes back if the server refuses. */
export const useRemoveOrgMember = (organizationId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (memberId: string) =>
      mutateData(
        await api.app.organizations[':organizationId'].members[':memberId'].$delete({ param: { organizationId, memberId } }),
        'Could not remove.',
      ),
    onMutate: async (memberId) => ({
      rollback: await patchCache<OrganizationMember[]>(qc, peopleKeys.orgMembers(organizationId), (members) =>
        members.filter((m) => m.id !== memberId),
      ),
    }),
    onError: (_error, _id, context) => context?.rollback(),
    onSettled: () => refreshOrgPeople(qc, organizationId),
  });
};

/** optimistic: the invitation leaves the list; a 409 (already accepted) puts it back and refreshes members too. */
export const useRevokeOrgInvitation = (organizationId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (id: string) =>
      mutateData(await api.app.organizations[':organizationId'].invitations[':id'].$delete({ param: { organizationId, id } }), 'Could not revoke.'),
    onMutate: async (id) => ({
      rollback: await patchCache<OrgInvitation[]>(qc, peopleKeys.orgInvitations(organizationId), (list) => list.filter((i) => i.id !== id)),
    }),
    onError: (_error, _id, context) => context?.rollback(),
    onSettled: () => refreshOrgPeople(qc, organizationId),
  });
};

/** server-confirmed: a fresh expiry from the server, and maybe an email. */
export const useResendOrgInvitation = (organizationId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (id: string) =>
      mutateData<{ id: string; expiresAt: string; emailed: boolean }>(
        await api.app.organizations[':organizationId'].invitations[':id'].resend.$post({ param: { organizationId, id } }),
        'Could not resend.',
      ),
    onSuccess: (result) =>
      qc.setQueryData<OrgInvitation[]>(peopleKeys.orgInvitations(organizationId), (list) =>
        list?.map((invitation) => (invitation.id === result.id ? { ...invitation, expiresAt: result.expiresAt } : invitation)),
      ),
    onError: () => qc.invalidateQueries({ queryKey: peopleKeys.orgInvitations(organizationId) }),
  });
};

// ─── Website team ───────────────────────────────────────────────────────────

/** server-confirmed: adds an existing org member directly or creates an invitation. */
export const useInviteToSite = (projectId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (body: { email: string; role: SiteRole }) =>
      mutateData<{ id: string; email: string; role: string; status: string; emailed?: boolean; changed?: boolean }>(
        await api.app.projects[':projectId'].members.invite.$post({ param: { projectId }, json: body }),
        'Could not add this person.',
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: peopleKeys.siteTeam(projectId) }),
  });
};

/** optimistic: the select shows the new role at once; a refusal puts the old one back. Writes to one person share a scope, so they run in click order. */
export const useChangeSiteRole = (projectId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    scope: { id: `site-role:${projectId}` },
    mutationFn: async ({ memberId, role }: { memberId: string; role: SiteRole }) =>
      mutateData(
        await api.app.projects[':projectId'].members[':id'].role.$patch({ param: { projectId, id: memberId }, json: { role } }),
        'Could not change the role.',
      ),
    onMutate: async ({ memberId, role }) => ({
      rollback: await patchCache<SiteTeam>(qc, peopleKeys.siteTeam(projectId), (team) => ({
        ...team,
        members: team.members.map((member) => (member.id === memberId ? { ...member, role } : member)),
      })),
    }),
    onError: (_error, _vars, context) => context?.rollback(),
    onSettled: () => {
      // Only the last of overlapping role changes refetches, so an older response never flickers over a newer click.
      if (qc.isMutating({ predicate: (m) => m.options.scope?.id === `site-role:${projectId}` }) <= 1)
        return qc.invalidateQueries({ queryKey: peopleKeys.siteTeam(projectId) });
    },
  });
};

/** optimistic: removes the person from this website only; they stay in the organization. */
export const useRemoveFromSite = (projectId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (memberId: string) =>
      mutateData(await api.app.projects[':projectId'].members[':id'].$delete({ param: { projectId, id: memberId } }), 'Could not remove.'),
    onMutate: async (memberId) => ({
      rollback: await patchCache<SiteTeam>(qc, peopleKeys.siteTeam(projectId), (team) => ({
        ...team,
        members: team.members.filter((member) => member.id !== memberId),
      })),
    }),
    onError: (_error, _id, context) => context?.rollback(),
    onSettled: () => qc.invalidateQueries({ queryKey: peopleKeys.siteTeam(projectId) }),
  });
};

/** optimistic: drops this website from the invitation (an invitation left with none is cancelled). */
export const useRevokeSiteInvitation = (projectId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (id: string) =>
      mutateData(await api.app.projects[':projectId'].members.invitations[':id'].$delete({ param: { projectId, id } }), 'Could not revoke.'),
    onMutate: async (id) => ({
      rollback: await patchCache<SiteTeam>(qc, peopleKeys.siteTeam(projectId), (team) => ({
        ...team,
        invitations: team.invitations.filter((invitation) => invitation.id !== id),
      })),
    }),
    onError: (_error, _id, context) => context?.rollback(),
    onSettled: () => qc.invalidateQueries({ queryKey: peopleKeys.siteTeam(projectId) }),
  });
};

/** server-confirmed: fresh expiry, maybe an email. */
export const useResendSiteInvitation = (projectId: string) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (id: string) =>
      mutateData<{ id: string; expiresAt: string; emailed: boolean }>(
        await api.app.projects[':projectId'].members.invitations[':id'].resend.$post({ param: { projectId, id } }),
        'Could not resend.',
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: peopleKeys.siteTeam(projectId) }),
  });
};

// ─── Join links (organization or one website) ───────────────────────────────

export type LinkScope = { kind: 'org'; organizationId: string } | { kind: 'site'; projectId: string };
const linkKey = (scope: LinkScope) =>
  scope.kind === 'org' ? peopleKeys.orgJoinLinks(scope.organizationId) : peopleKeys.siteJoinLinks(scope.projectId);

export interface LinkBody {
  label?: string;
  grants: Grant[];
  allowedDomain: string | null;
  maxUses: number | null;
  expiresInDays: number | null;
}
type CreatedLink = { link: JoinLinkRecord; token: string; url: string };

/** server-confirmed: the URL exists only in this response (only a hash is stored). */
export const useCreateJoinLink = (scope: LinkScope) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (body: LinkBody): Promise<CreatedLink> => {
      if (scope.kind === 'org')
        return mutateData<CreatedLink>(
          await api.app.organizations[':organizationId']['join-links'].$post({ param: { organizationId: scope.organizationId }, json: body }),
          'Could not create the link.',
        );
      const role = body.grants[0]?.role ?? 'viewer';
      return mutateData<CreatedLink>(
        await api.app.projects[':projectId']['join-links'].$post({
          param: { projectId: scope.projectId },
          json: {
            role,
            ...(body.label ? { label: body.label } : {}),
            ...(body.allowedDomain ? { allowedDomain: body.allowedDomain } : {}),
            ...(body.maxUses ? { maxUses: body.maxUses } : {}),
            ...(body.expiresInDays ? { expiresInDays: body.expiresInDays } : {}),
          },
        }),
        'Could not create the link.',
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: linkKey(scope) }),
  });
};

/** server-confirmed: a new token for the same settings; the old URL stops working. */
export const useRegenerateJoinLink = (scope: LinkScope) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (id: string): Promise<CreatedLink> =>
      scope.kind === 'org'
        ? mutateData<CreatedLink>(
            await api.app.organizations[':organizationId']['join-links'][':id'].regenerate.$post({
              param: { organizationId: scope.organizationId, id },
            }),
            'Could not regenerate the link.',
          )
        : mutateData<CreatedLink>(
            await api.app.projects[':projectId']['join-links'][':id'].regenerate.$post({ param: { projectId: scope.projectId, id } }),
            'Could not regenerate the link.',
          ),
    onSettled: () => qc.invalidateQueries({ queryKey: linkKey(scope) }),
  });
};

/** server-confirmed: disabling is final; the server returns the link's new state. */
export const useDisableJoinLink = (scope: LinkScope) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (id: string) =>
      scope.kind === 'org'
        ? mutateData(
            await api.app.organizations[':organizationId']['join-links'][':id'].$delete({
              param: { organizationId: scope.organizationId, id },
              query: {},
            }),
            'Could not disable the link.',
          )
        : mutateData(
            await api.app.projects[':projectId']['join-links'][':id'].revoke.$post({ param: { projectId: scope.projectId, id } }),
            'Could not disable the link.',
          ),
    onSettled: () => qc.invalidateQueries({ queryKey: linkKey(scope) }),
  });
};

/** optimistic: a link that no longer admits anyone leaves the list. */
export const useDeleteJoinLink = (scope: LinkScope) => {
  const qc = useSessionQueryClient();
  return useSessionMutation({
    mutationFn: async (id: string) =>
      scope.kind === 'org'
        ? mutateData(
            await api.app.organizations[':organizationId']['join-links'][':id'].$delete({
              param: { organizationId: scope.organizationId, id },
              query: { permanent: 'true' },
            }),
            'Could not delete the link.',
          )
        : mutateData(
            await api.app.projects[':projectId']['join-links'][':id'].$delete({ param: { projectId: scope.projectId, id } }),
            'Could not delete the link.',
          ),
    onMutate: async (id) => ({
      rollback: await patchCache<JoinLinkRecord[]>(qc, linkKey(scope), (links) => links.filter((link) => link.id !== id)),
    }),
    onError: (_error, _id, context) => context?.rollback(),
    onSettled: () => qc.invalidateQueries({ queryKey: linkKey(scope) }),
  });
};

// ─── Accept and join ────────────────────────────────────────────────────────

/** Join the link's organization and websites as the signed-in person. */
export const useJoinWithLink = () =>
  useSessionMutation({
    mutationFn: async (token: string) => mutateData(await api.app.join[':token'].$post({ param: { token } }), 'Could not join.'),
  });

/** True when a refused revoke means "already accepted" (409 invitation_accepted). */
export const isAlreadyAccepted = (error: unknown) => error instanceof ApiResponseError && error.reason === 'invitation_accepted';
