import { ASSIGNABLE_MEMBER_ROLES } from '@nibleaf/shared/rbac';
import { describe, expect, it } from 'vitest';
import { DEFAULT_INVITE_ROLE, ROLE_COPY, ROLE_PICKER_ORDER, roleLabelKey } from './member-roles';

describe('member role copy', () => {
  it('names every role, Editor for the stored `member`', () => {
    expect(roleLabelKey('owner')).toBe('roles.owner');
    expect(roleLabelKey('admin')).toBe('roles.admin');
    expect(roleLabelKey('member')).toBe('roles.editor');
    expect(roleLabelKey('viewer')).toBe('roles.viewer');
  });

  it('reads an unknown or missing role as the least privileged one', () => {
    expect(roleLabelKey('superuser')).toBe('roles.viewer');
    expect(roleLabelKey(null)).toBe('roles.viewer');
    expect(roleLabelKey(undefined)).toBe('roles.viewer');
  });

  it('gives every role a description', () => {
    for (const copy of Object.values(ROLE_COPY)) expect(copy.hint).toMatch(/^roles\.[a-z]+Hint$/);
  });

  it('offers exactly the assignable roles, least access first, never owner', () => {
    expect([...ROLE_PICKER_ORDER].sort()).toEqual([...ASSIGNABLE_MEMBER_ROLES].sort());
    expect(ROLE_PICKER_ORDER).toEqual(['viewer', 'member', 'admin']);
    expect(ROLE_PICKER_ORDER).not.toContain('owner');
  });

  it('keeps inviting Editors by default', () => {
    expect(DEFAULT_INVITE_ROLE).toBe('member');
  });
});
