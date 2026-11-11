import { describe, expect, it } from 'vitest';
import { canManageOrgPeople, canManageSiteTeam, canOnOrgMember, canOnSiteMember, type OrgAction } from './permissions';

const owner = { userId: 'u-owner', orgRole: 'owner' as const };
const admin = { userId: 'u-admin', orgRole: 'admin' as const };
const member = { userId: 'u-member', orgRole: 'member' as const };
const reason = (decision: ReturnType<typeof canOnOrgMember>) => (decision.allowed ? 'allowed' : decision.reason);

describe('org people permissions', () => {
  it('lets only the Owner and Admins manage people', () => {
    expect(canManageOrgPeople(owner)).toBe(true);
    expect(canManageOrgPeople(admin)).toBe(true);
    expect(canManageOrgPeople(member)).toBe(false);
    expect(reason(canOnOrgMember(member, 'remove', { userId: 'x', orgRole: 'member' }))).toBe('people.reason.adminOnly');
  });

  it.each<[string, OrgAction, { userId: string; orgRole: string }, string]>([
    ['owner', 'manageAccess', { userId: 'x', orgRole: 'member' }, 'allowed'],
    ['owner', 'manageAccess', { userId: 'x', orgRole: 'admin' }, 'allowed'],
    ['admin', 'manageAccess', { userId: 'u-owner', orgRole: 'owner' }, 'people.reason.ownerRoleByTransfer'],
    ['admin', 'manageAccess', { userId: 'u-admin', orgRole: 'admin' }, 'people.reason.ownRole'],
    ['admin', 'remove', { userId: 'x', orgRole: 'admin' }, 'allowed'],
    ['admin', 'remove', { userId: 'u-owner', orgRole: 'owner' }, 'people.reason.ownerCannotBeRemoved'],
    ['owner', 'remove', { userId: 'u-owner', orgRole: 'owner' }, 'people.reason.ownerCannotBeRemoved'],
    ['admin', 'remove', { userId: 'u-admin', orgRole: 'admin' }, 'people.reason.leaveInstead'],
    ['admin', 'transferOwnership', { userId: 'x', orgRole: 'admin' }, 'people.reason.onlyOwnerTransfers'],
    ['owner', 'transferOwnership', { userId: 'x', orgRole: 'member' }, 'people.reason.transferToAdmin'],
    ['owner', 'transferOwnership', { userId: 'x', orgRole: 'admin' }, 'allowed'],
    ['owner', 'transferOwnership', { userId: 'u-owner', orgRole: 'owner' }, 'people.reason.alreadyOwner'],
  ])('%s → %s on %o: %s', (who, action, target, expected) => {
    expect(reason(canOnOrgMember(who === 'owner' ? owner : admin, action, target))).toBe(expected);
  });
});

describe('website team permissions', () => {
  const siteAdmin = { userId: 'me', role: 'admin' as const };
  it('lets only site Admins (incl. org Owner/Admins) manage the team', () => {
    expect(canManageSiteTeam({ role: 'owner' })).toBe(true);
    expect(canManageSiteTeam({ role: 'admin' })).toBe(true);
    expect(canManageSiteTeam({ role: 'member' })).toBe(false);
    expect(canManageSiteTeam({ role: 'viewer' })).toBe(false);
    expect(canManageSiteTeam({ role: null })).toBe(false);
  });
  it.each([
    [{ userId: 'x', role: 'member', viaOrganization: false }, 'changeRole', 'allowed'],
    [{ userId: 'x', role: 'owner', viaOrganization: true }, 'remove', 'people.reason.viaOrganization'],
    [{ userId: 'me', role: 'admin', viaOrganization: false }, 'remove', 'people.reason.removeSelfSite'],
    [{ userId: 'me', role: 'admin', viaOrganization: false }, 'changeRole', 'people.reason.ownRole'],
  ] as const)('site Admin on %o %s: %s', (target, action, expected) => {
    const decision = canOnSiteMember(siteAdmin, action, target);
    expect(decision.allowed ? 'allowed' : decision.reason).toBe(expected);
  });
  it('explains to an Editor why they cannot change anyone', () => {
    const decision = canOnSiteMember({ userId: 'me', role: 'member' }, 'changeRole', { userId: 'x', role: 'viewer', viaOrganization: false });
    expect(decision).toEqual({ allowed: false, reason: 'people.reason.siteAdminOnly' });
  });
});
