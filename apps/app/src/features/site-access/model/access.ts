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

type SiteMember = { role: SiteRole; orgRole: OrgRole | null; viaOrganization: boolean };

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
  | { type: 'site.member.remove'; member: SiteMember }
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
    case 'site.settings.manage':
    case 'site.members.manage':
    case 'site.domain.manage':
      return permission(canAdminister(access.role), 'settings.permissions.title');
    case 'site.content.edit':
      return permission(canEdit(access.role), 'access.viewOnly.action');
    case 'site.member.remove':
      // members-section.tsx hides organization-managed rows; actions/members.ts
      // removeMember refuses them, including the owner. Never offer rank escalation.
      if (!canAdminister(access.role)) return permission(false, 'settings.permissions.title');
      if (action.member.viaOrganization || canAdminister(action.member.orgRole ?? '') || roleAtLeast(action.member.role, 'owner')) {
        return permission(false, 'access.reason.organizationMember');
      }
      return permission(canManageMember(access.role, action.member.role), 'settings.permissions.title');
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
      // actions/api-keys.ts issueScopes + settings/api-keys-tab.tsx selectionPermitted.
      // Every current McpScope requires MEMBER (shared/mcp.ts MCP_SCOPE_MIN_ROLE);
      // only the full_admin preset additionally requires ADMIN. Parity is tested.
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
