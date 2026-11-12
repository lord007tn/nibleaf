import type { MessageKey } from '@nibleaf/i18n';
import type { MemberRole as SiteRole } from '@nibleaf/shared/constants';
import type { McpKeyPreset, McpScope } from '@nibleaf/shared/mcp';
import {
  canAdminister,
  canEdit,
  canManageMember,
  canView,
  EXPORT_CREATE_ROLE,
  EXPORT_SCHEDULE_ROLE,
  ORG_ROLES,
  type OrgRole,
  roleAtLeast,
} from '@nibleaf/shared/rbac';

export type SiteAccess =
  | { status: 'loading' }
  | { status: 'unavailable'; retry: () => void }
  | { status: 'ready'; role: SiteRole; orgRole: OrgRole | null; stale: boolean; retry: () => void }
  | { status: 'notMember' };

export type Decision = { kind: 'allowed' } | { kind: 'locked' } | { kind: 'denied'; reason: MessageKey };

/** `userId` lets a caller that knows the signed-in person forbid acting on yourself. */
type SiteMember = { role: SiteRole; orgRole: OrgRole | null; viaOrganization: boolean; userId?: string };

export type SiteAction =
  | {
      type:
        | 'site.settings.manage'
        | 'site.content.edit'
        | 'site.members.manage'
        | 'site.domain.manage'
        | 'site.delete'
        | 'site.exports.create'
        | 'site.exports.schedule';
    }
  | { type: 'site.member.remove'; member: SiteMember; sessionUserId?: string }
  | { type: 'site.member.changeRole'; member: SiteMember; sessionUserId?: string }
  | { type: 'site.ownership.transfer'; target: { user: { id: string }; orgRole: OrgRole | null }; sessionUserId: string }
  | { type: 'site.apiKeys.create'; scope: McpKeyPreset | readonly McpScope[] }
  | { type: 'site.apiKeys.revoke'; key: { createdBy: { id: string } | null }; sessionUserId: string };

const permission = (allowed: boolean, reason: MessageKey): Decision => (allowed ? { kind: 'allowed' } : { kind: 'denied', reason });

/** UI policy only: every write remains authorized by the server. */
export function decide(access: SiteAccess, action: SiteAction): Decision {
  if (access.status === 'loading' || access.status === 'unavailable') return { kind: 'locked' };
  if (access.status === 'notMember') return { kind: 'denied', reason: 'access.reason.notMember' };

  switch (action.type) {
    // Existing settings route, members-section and domain settings use canAdminister.
    // `site.settings.manage` covers the website's own settings only. It does NOT
    // authorize the plan or notification defaults: those belong to the
    // organization and need its Owner or Admin role (apps/server/src/actions/
    // workspace.ts ORGANIZATION_FIELDS). Give them their own decision when those
    // controls adopt this model, rather than widening this one.
    case 'site.settings.manage':
    case 'site.members.manage':
    case 'site.domain.manage':
      return permission(canAdminister(access.role), 'settings.permissions.title');
    case 'site.content.edit':
      return permission(canEdit(access.role), 'access.viewOnly.action');
    case 'site.member.remove':
    case 'site.member.changeRole': {
      // The website Team page offers both; actions/members.ts removeMember and
      // updateMemberRole refuse organization-managed rows, including the owner.
      // Never offer rank escalation, and never act on yourself (ask another Admin).
      // The self rule is UI POLICY ONLY: the server PERMITS self-removal and
      // self-demotion (actions/members.ts removeMember / updateMemberRole), so
      // a parity pass must not read this stricter check as drift. It applies
      // only when the caller passes `sessionUserId` and the member's `userId`.
      if (!canAdminister(access.role)) return permission(false, 'settings.permissions.title');
      if (action.member.viaOrganization || canAdminister(action.member.orgRole ?? '') || roleAtLeast(action.member.role, 'owner')) {
        return permission(false, 'access.reason.organizationMember');
      }
      if (action.sessionUserId && action.member.userId === action.sessionUserId) {
        return permission(false, action.type === 'site.member.remove' ? 'people.reason.removeSelfSite' : 'people.reason.ownRole');
      }
      return permission(canManageMember(access.role, action.member.role), 'settings.permissions.title');
    }
    case 'site.delete':
      // modules/app/projects/routes.ts remove uses requireProjectOrgRole(ADMIN).
      return permission(canAdminister(access.orgRole ?? ''), 'access.reason.organizationAdmin');
    case 'site.ownership.transfer':
      // danger-section.tsx targets another org Admin; actions/organizations.ts
      // transferOrganizationOwnership applies planOwnershipTransfer to org roles.
      if (!roleAtLeast(access.orgRole ?? '', 'owner')) return permission(false, 'access.reason.owner');
      return permission(
        Boolean(action.sessionUserId) &&
          Boolean(action.target.user.id) &&
          action.target.user.id !== action.sessionUserId &&
          canAdminister(action.target.orgRole ?? '') &&
          !roleAtLeast(action.target.orgRole ?? '', 'owner'),
        'access.reason.transferTarget',
      );
    case 'site.apiKeys.create':
      // actions/api-keys.ts issueScopes + features/ai-assistants/components/key-dialog.tsx selectionPermitted.
      // Every current McpScope requires MEMBER (shared/mcp.ts MCP_SCOPE_MIN_ROLE);
      // only the full_admin preset additionally requires ADMIN. Parity is tested.
      //
      // Eligibility only: whether this role may hold these scopes. It does not
      // say a custom selection is complete. The request schema (validators
      // createApiKeyBody) also requires `mcp:connect`, so ['pages:read'] is
      // eligible here and still refused there; the API-keys form always keeps
      // `mcp:connect` selected. Both halves are tested.
      return permission(
        Array.isArray(action.scope)
          ? action.scope.length > 0 && canEdit(access.role)
          : action.scope === 'full_admin'
            ? canAdminister(access.role)
            : canEdit(access.role),
        'access.reason.keyScope',
      );
    case 'site.apiKeys.revoke':
      // modules/app/api-keys/routes.ts requires MEMBER even for creators;
      // actions/api-keys.ts ownership permits an Admin or the key's creator.
      return permission(
        canEdit(access.role) && (canAdminister(access.role) || (Boolean(action.sessionUserId) && action.key.createdBy?.id === action.sessionUserId)),
        'access.reason.keyOwner',
      );
    // modules/app/exports/routes.ts uses these same shared policy constants.
    case 'site.exports.create':
      return permission(roleAtLeast(access.role, EXPORT_CREATE_ROLE), 'access.viewOnly.action');
    case 'site.exports.schedule':
      return permission(roleAtLeast(access.role, EXPORT_SCHEDULE_ROLE), 'settings.permissions.title');
    default: {
      const exhaustive: never = action;
      throw new Error(`Unknown site action: ${exhaustive}`);
    }
  }
}

type MembersInput = {
  members: readonly { user: { id: string }; role: string; orgRole?: string }[] | undefined;
  sessionUserId: string | undefined;
  pending: boolean;
  failed: boolean;
  cachedData: boolean;
  retry: () => void;
};

/** Use the server's effective role verbatim; never reconstruct it from grants. */
export function siteAccessFromMembers({ members, sessionUserId, pending, failed, cachedData, retry }: MembersInput): SiteAccess {
  if (failed && !cachedData) return { status: 'unavailable', retry };
  if (pending || !sessionUserId || !cachedData) return { status: 'loading' };
  const member = members?.find((candidate) => candidate.user.id === sessionUserId);
  if (!member || !canView(member.role)) return { status: 'notMember' };
  const orgRole = ORG_ROLES.find((role) => role === member.orgRole) ?? null;
  return { status: 'ready', role: member.role as SiteRole, orgRole, stale: failed, retry };
}
