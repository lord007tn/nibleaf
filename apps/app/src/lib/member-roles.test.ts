import { describe, expect, it } from 'vitest';
import { ROLE_COPY, roleLabelKey } from './member-roles';

describe('member role copy', () => {
  it('names every role, Editor for the stored `member`', () => {
    expect(roleLabelKey('owner')).toBe('roles.owner');
    expect(roleLabelKey('admin')).toBe('roles.admin');
    expect(roleLabelKey('member')).toBe('roles.editor');
    expect(roleLabelKey('viewer')).toBe('roles.viewer');
  });

  it('labels an unrecognised stored role as unknown, and a missing one as Viewer', () => {
    expect(roleLabelKey('superuser')).toBe('roles.unknown');
    expect(roleLabelKey(null)).toBe('roles.viewer');
    expect(roleLabelKey(undefined)).toBe('roles.viewer');
  });

  it('gives every role a description', () => {
    for (const copy of Object.values(ROLE_COPY)) expect(copy.hint).toMatch(/^roles\.[a-z]+Hint$/);
  });
});

describe('roleLabelKey ignores inherited object keys', () => {
  it.each(['constructor', 'toString', '__proto__'])('treats %s as an unknown role', (role) => {
    expect(roleLabelKey(role)).toBe('roles.unknown');
  });
});
