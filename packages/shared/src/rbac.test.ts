import { describe, expect, it } from 'vitest';
import { MemberRole } from './constants';
import { canAdminister, canAssignRole, canEdit, canManageMember, rankOf, roleAtLeast } from './rbac';

describe('rankOf', () => {
  it('orders owner > admin > member > unknown', () => {
    expect(rankOf('owner')).toBeGreaterThan(rankOf('admin'));
    expect(rankOf('admin')).toBeGreaterThan(rankOf('member'));
    expect(rankOf('member')).toBeGreaterThan(rankOf('viewer'));
    expect(rankOf('nonsense')).toBe(0);
  });
});

describe('canAssignRole — never grant above your own rank', () => {
  it('blocks an admin from minting/promoting an owner', () => {
    expect(canAssignRole('admin', 'owner')).toBe(false);
  });
  it('lets an owner assign any role', () => {
    expect(canAssignRole('owner', 'owner')).toBe(true);
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
