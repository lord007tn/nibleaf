import { describe, expect, it } from 'vitest';
import { canManageOrgPeople, canOnOrgMember, type OrgAction } from './permissions';

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
