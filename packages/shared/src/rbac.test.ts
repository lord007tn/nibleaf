import { describe, expect, it } from 'vitest';
import { MemberRole } from './constants';
import { ASSIGNABLE_MEMBER_ROLES, canAdminister, canAssignRole, canEdit, canManageMember, planOwnershipTransfer, rankOf, roleAtLeast } from './rbac';

describe('rankOf', () => {
  it('orders owner > admin > member > unknown', () => {
    expect(rankOf('owner')).toBeGreaterThan(rankOf('admin'));
    expect(rankOf('admin')).toBeGreaterThan(rankOf('member'));
    expect(rankOf('member')).toBeGreaterThan(rankOf('viewer'));
    expect(rankOf('nonsense')).toBe(0);
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
    expect(ASSIGNABLE_MEMBER_ROLES).toEqual([MemberRole.ADMIN, MemberRole.MEMBER]);
  });
  it('lets an owner assign the non-owner roles', () => {
    expect(canAssignRole('owner', 'admin')).toBe(true);
    expect(canAssignRole('owner', 'member')).toBe(true);
  });
  it('lets an admin assign admin and member only', () => {
    expect(canAssignRole('admin', 'admin')).toBe(true);
    expect(canAssignRole('admin', 'member')).toBe(true);
  });
  it('lets a member assign only member', () => {
    expect(canAssignRole('member', 'admin')).toBe(false);
    expect(canAssignRole('member', 'member')).toBe(true);
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
