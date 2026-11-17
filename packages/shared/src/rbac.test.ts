import { describe, expect, it } from 'vitest';
import { MemberRole } from './constants';
import { MCP_KEY_PRESETS, mcpPresetScopesForRole, mcpScopesForRole } from './mcp';
import {
  ASSIGNABLE_MEMBER_ROLES,
  ASSIGNABLE_ORG_ROLES,
  ASSIGNABLE_SITE_ROLES,
  canAdminister,
  canAssignRole,
  canEdit,
  canManageMember,
  canView,
  EXPORT_CREATE_ROLE,
  EXPORT_SCHEDULE_ROLE,
  effectiveSiteRole,
  issuerRefusal,
  planOwnershipTransfer,
  rankOf,
  roleAtLeast,
} from './rbac';

describe('organization roles and website grants', () => {
  it.each(['admin', 'member', 'viewer', null])('inherits organization authority over a dormant %s grant', (grant) => {
    expect(effectiveSiteRole('owner', grant)).toBe('owner');
    expect(effectiveSiteRole('admin', grant)).toBe('admin');
  });
  it.each(['admin', 'member', 'viewer'])('uses a member grant of %s', (grant) => {
    expect(effectiveSiteRole('member', grant)).toBe(grant);
  });
  it('fails closed for missing or invalid grants and invalid organization roles', () => {
    expect(effectiveSiteRole('member', null)).toBeNull();
    expect(effectiveSiteRole('member', 'owner')).toBeNull();
    expect(effectiveSiteRole('viewer', 'admin')).toBeNull();
    expect(effectiveSiteRole('unknown', 'admin')).toBeNull();
    expect(ASSIGNABLE_ORG_ROLES).toEqual(['admin', 'member']);
    expect(ASSIGNABLE_SITE_ROLES).toEqual(['admin', 'member', 'viewer']);
  });
});

describe('rankOf', () => {
  it('orders owner > admin > member > viewer > unknown', () => {
    expect(rankOf('owner')).toBeGreaterThan(rankOf('admin'));
    expect(rankOf('admin')).toBeGreaterThan(rankOf('member'));
    expect(rankOf('member')).toBeGreaterThan(rankOf('viewer'));
    expect(rankOf('viewer')).toBeGreaterThan(rankOf('nonsense'));
    expect(rankOf('nonsense')).toBe(0);
  });
});

describe('viewer — reads a site, never changes it', () => {
  it('can view but not edit or administer', () => {
    expect(canView(MemberRole.VIEWER)).toBe(true);
    expect(canEdit(MemberRole.VIEWER)).toBe(false);
    expect(canAdminister(MemberRole.VIEWER)).toBe(false);
    expect(roleAtLeast(MemberRole.VIEWER, MemberRole.MEMBER)).toBe(false);
  });
  it('every real role can view; an unknown role cannot', () => {
    for (const role of Object.values(MemberRole)) expect(canView(role)).toBe(true);
    expect(canView('')).toBe(false);
    expect(canView('nonsense')).toBe(false);
  });
  it('cannot create exports or manage schedules', () => {
    expect(roleAtLeast(MemberRole.VIEWER, EXPORT_CREATE_ROLE)).toBe(false);
    expect(roleAtLeast(MemberRole.VIEWER, EXPORT_SCHEDULE_ROLE)).toBe(false);
  });
  it('cannot assign any role but viewer, and cannot manage editors', () => {
    expect(canAssignRole(MemberRole.VIEWER, MemberRole.VIEWER)).toBe(true);
    expect(canAssignRole(MemberRole.VIEWER, MemberRole.MEMBER)).toBe(false);
    expect(canManageMember(MemberRole.VIEWER, MemberRole.MEMBER)).toBe(false);
  });
  it('can be granted and managed by admins and owners', () => {
    expect(canAssignRole(MemberRole.ADMIN, MemberRole.VIEWER)).toBe(true);
    expect(canAssignRole(MemberRole.OWNER, MemberRole.VIEWER)).toBe(true);
    expect(canManageMember(MemberRole.ADMIN, MemberRole.VIEWER)).toBe(true);
  });
  it('gets no MCP scopes and no MCP key preset', () => {
    expect(mcpScopesForRole(MemberRole.VIEWER)).toEqual([]);
    for (const preset of MCP_KEY_PRESETS) expect(mcpPresetScopesForRole(preset, MemberRole.VIEWER)).toBeNull();
    // Editors keep their existing scopes.
    expect(mcpScopesForRole(MemberRole.MEMBER).length).toBeGreaterThan(0);
  });
});

describe('canAssignRole — owner is never assignable; otherwise never above your own rank', () => {
  it('blocks EVERYONE — including the owner — from granting the owner role', () => {
    expect(canAssignRole('owner', 'owner')).toBe(false);
    expect(canAssignRole('admin', 'owner')).toBe(false);
    expect(canAssignRole('member', 'owner')).toBe(false);
  });
  it('excludes owner from the assignable-roles set', () => {
    expect(ASSIGNABLE_MEMBER_ROLES).not.toContain(MemberRole.OWNER);
    expect(ASSIGNABLE_MEMBER_ROLES).toEqual([MemberRole.ADMIN, MemberRole.MEMBER, MemberRole.VIEWER]);
  });
  it('lets an owner assign the non-owner roles', () => {
    expect(canAssignRole('owner', 'admin')).toBe(true);
    expect(canAssignRole('owner', 'member')).toBe(true);
  });
  it('lets an admin assign admin and member only', () => {
    expect(canAssignRole('admin', 'admin')).toBe(true);
    expect(canAssignRole('admin', 'member')).toBe(true);
  });
  it('lets a member assign member and viewer only', () => {
    expect(canAssignRole('member', 'admin')).toBe(false);
    expect(canAssignRole('member', 'member')).toBe(true);
    expect(canAssignRole('member', 'viewer')).toBe(true);
  });
  it('blocks an unknown actor role from assigning any real role', () => {
    expect(canAssignRole('', 'member')).toBe(false);
  });
});

describe('planOwnershipTransfer — exactly one owner after every valid transfer', () => {
  const owner = { id: 'm-owner', role: 'owner' };
  const admin = { id: 'm-admin', role: 'admin' };
  const editor = { id: 'm-editor', role: 'member' };

  it('swaps roles: target promoted, current owner demoted to admin', () => {
    const plan = planOwnershipTransfer([owner, admin, editor], owner.id, admin.id);
    expect(plan).toEqual({ ok: true, demote: [owner.id], promote: admin.id });
  });
  it('demotes ALL owners when legacy data holds several (ending state = one owner)', () => {
    const legacyOwner = { id: 'm-legacy', role: 'owner' };
    const plan = planOwnershipTransfer([owner, legacyOwner, admin], owner.id, admin.id);
    expect(plan).toEqual({ ok: true, demote: [owner.id, legacyOwner.id], promote: admin.id });
  });
  it('rejects when the actor is not a member', () => {
    expect(planOwnershipTransfer([owner, admin], 'm-ghost', admin.id)).toEqual({ ok: false, reason: 'actor_not_found' });
  });
  it('rejects when the actor is not the owner', () => {
    expect(planOwnershipTransfer([owner, admin, editor], admin.id, editor.id)).toEqual({ ok: false, reason: 'actor_not_owner' });
  });
  it('rejects transferring to yourself', () => {
    expect(planOwnershipTransfer([owner, admin], owner.id, owner.id)).toEqual({ ok: false, reason: 'target_is_actor' });
  });
  it('rejects an unknown target', () => {
    expect(planOwnershipTransfer([owner, admin], owner.id, 'm-ghost')).toEqual({ ok: false, reason: 'target_not_found' });
  });
  it('rejects a target that is already an owner (legacy data)', () => {
    const legacyOwner = { id: 'm-legacy', role: 'owner' };
    expect(planOwnershipTransfer([owner, legacyOwner], owner.id, legacyOwner.id)).toEqual({ ok: false, reason: 'target_already_owner' });
  });
  it('rejects a non-admin target — ownership only transfers to an admin', () => {
    expect(planOwnershipTransfer([owner, admin, editor], owner.id, editor.id)).toEqual({ ok: false, reason: 'target_not_admin' });
  });
});

describe('canManageMember — never act on someone ranked above you', () => {
  it('blocks an admin from managing an owner', () => {
    expect(canManageMember('admin', 'owner')).toBe(false);
  });
  it('lets an owner manage everyone', () => {
    expect(canManageMember('owner', 'owner')).toBe(true);
    expect(canManageMember('owner', 'admin')).toBe(true);
  });
  it('lets an admin manage members and peers', () => {
    expect(canManageMember('admin', 'member')).toBe(true);
    expect(canManageMember('admin', 'admin')).toBe(true);
  });
});

describe('capability helpers', () => {
  it('canEdit requires at least member', () => {
    expect(canEdit('member')).toBe(true);
    expect(canEdit('admin')).toBe(true);
    expect(canEdit('')).toBe(false);
  });
  it('canAdminister requires at least admin', () => {
    expect(canAdminister('member')).toBe(false);
    expect(canAdminister('admin')).toBe(true);
    expect(canAdminister('owner')).toBe(true);
  });
  it('roleAtLeast respects the MemberRole enum', () => {
    expect(roleAtLeast('owner', MemberRole.ADMIN)).toBe(true);
    expect(roleAtLeast('member', MemberRole.ADMIN)).toBe(false);
  });
});

describe('export permissions', () => {
  it('allows editors to create runs but reserves schedules for admins', () => {
    expect(roleAtLeast(MemberRole.MEMBER, EXPORT_CREATE_ROLE)).toBe(true);
    expect(roleAtLeast(MemberRole.MEMBER, EXPORT_SCHEDULE_ROLE)).toBe(false);
    expect(roleAtLeast(MemberRole.ADMIN, EXPORT_SCHEDULE_ROLE)).toBe(true);
    expect(roleAtLeast('viewer', EXPORT_CREATE_ROLE)).toBe(false);
  });
});

describe('issuerRefusal — who may issue (and resend) an invitation', () => {
  // <site#1> is the website whose Team page lists the invitation; <site#2> is another one.
  const SITE_1 = '00000000-0000-4000-8000-000000000001';
  const SITE_2 = '00000000-0000-4000-8000-000000000002';
  const issuer = (orgRole: string, grants: Array<[string, string]> = []) => ({
    orgRole,
    projectGrants: grants.map(([projectId, role]) => ({ projectId, role })),
  });
  const siteAdmin = issuer('member', [[SITE_1, 'admin']]);
  const adminOfBoth = issuer('member', [
    [SITE_1, 'admin'],
    [SITE_2, 'admin'],
  ]);
  const adminHereEditorThere = issuer('member', [
    [SITE_1, 'admin'],
    [SITE_2, 'member'],
  ]);
  const here = { projectId: SITE_1, role: 'member' };
  const there = { projectId: SITE_2, role: 'viewer' };
  it.each([
    // who views, the invitation's org role and grants, the refusal (null: may issue/resend), the viewer's roles
    ['org Owner', 'member', [here, there], null, issuer('owner')],
    ['org Owner', 'admin', [here], null, issuer('owner')],
    ['org Admin', 'admin', [], null, issuer('admin')],
    ['org Admin', 'member', [], null, issuer('admin')],
    ['org Admin', 'member', [here, { projectId: SITE_2, role: 'admin' }], null, issuer('admin')],
    ['site Admin', 'member', [here], null, siteAdmin],
    ['site Admin', 'member', [{ projectId: SITE_1, role: 'admin' }], null, siteAdmin],
    ['site Admin', 'admin', [here], 'orgAccess', siteAdmin],
    ['site Admin', 'member', [], 'orgAccess', siteAdmin],
    ['site Admin', 'member', [here, there], 'otherWebsites', siteAdmin],
    ['site Admin of both', 'member', [here, there], null, adminOfBoth],
    ['site Admin of both', 'admin', [here, there], 'orgAccess', adminOfBoth],
    ['site Admin here, Editor there', 'member', [here, there], null, adminHereEditorThere],
    ['site Admin here, Editor there', 'member', [here, { projectId: SITE_2, role: 'member' }], null, adminHereEditorThere],
    ['site Admin here, Editor there', 'member', [here, { projectId: SITE_2, role: 'admin' }], 'otherWebsites', adminHereEditorThere],
    ['org Owner', 'owner', [], 'orgAccess', issuer('owner')],
    ['org Owner', 'member', [{ projectId: SITE_1, role: 'owner' }], 'otherWebsites', issuer('owner')],
  ] as const)('%s, org %s invitation granting %j → %s', (_who, orgRole, grants, expected, viewer) => {
    expect(issuerRefusal(viewer, orgRole, grants)).toBe(expected);
  });
});
