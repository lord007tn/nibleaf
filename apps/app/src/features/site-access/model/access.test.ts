import type { MemberRole } from '@nibleaf/shared/constants';
import { MCP_KEY_PRESETS, MCP_PRESET_MIN_ROLE, MCP_SCOPES, mcpScopesForRole } from '@nibleaf/shared/mcp';
import { roleAtLeast } from '@nibleaf/shared/rbac';
import { describe, expect, it, vi } from 'vitest';
import { decide, type SiteAccess, type SiteAction, siteAccessFromMembers } from './access';

const roles = ['owner', 'admin', 'member', 'viewer'] as const;
const retry = vi.fn();
const ready = (role: MemberRole, stale = false): Extract<SiteAccess, { status: 'ready' }> => ({
  status: 'ready',
  role,
  orgRole: role === 'viewer' ? 'member' : role,
  stale,
  retry,
});
const target = (orgRole: 'owner' | 'admin' | 'member' | null, id = 'other') => ({ user: { id }, orgRole });
const adminOnly = ['allowed', 'allowed', 'denied', 'denied'] as const;
const editorOnly = ['allowed', 'allowed', 'allowed', 'denied'] as const;
const ownerOnly = ['allowed', 'denied', 'denied', 'denied'] as const;
const nobody = ['denied', 'denied', 'denied', 'denied'] as const;

const cases: { name: string; action: SiteAction; expected: readonly string[] }[] = [
  { name: 'settings', action: { type: 'site.settings.manage' }, expected: adminOnly },
  { name: 'content', action: { type: 'site.content.edit' }, expected: editorOnly },
  { name: 'members', action: { type: 'site.members.manage' }, expected: adminOnly },
  { name: 'domain', action: { type: 'site.domain.manage' }, expected: adminOnly },
  { name: 'delete', action: { type: 'site.delete' }, expected: adminOnly },
  { name: 'create export', action: { type: 'site.exports.create' }, expected: editorOnly },
  { name: 'schedule export', action: { type: 'site.exports.schedule' }, expected: adminOnly },
  ...roles.flatMap((role) =>
    [false, true].map((viaOrganization) => ({
      name: `remove ${role} viaOrganization=${viaOrganization}`,
      action: { type: 'site.member.remove', member: { role, orgRole: 'member', viaOrganization } } satisfies SiteAction,
      expected: viaOrganization || role === 'owner' ? nobody : adminOnly,
    })),
  ),
  {
    name: 'remove org admin',
    action: { type: 'site.member.remove', member: { role: 'admin', orgRole: 'admin', viaOrganization: false } },
    expected: nobody,
  },
  ...(['owner', 'admin', 'member', null] as const).map((orgRole) => ({
    name: `transfer to ${orgRole}`,
    action: { type: 'site.ownership.transfer', target: target(orgRole), sessionUserId: 'me' } satisfies SiteAction,
    expected: orgRole === 'admin' ? ownerOnly : nobody,
  })),
  { name: 'transfer to self', action: { type: 'site.ownership.transfer', target: target('admin', 'me'), sessionUserId: 'me' }, expected: nobody },
  { name: 'transfer without identity', action: { type: 'site.ownership.transfer', target: target('admin'), sessionUserId: '' }, expected: nobody },
  ...MCP_KEY_PRESETS.map((scope) => ({
    name: `create ${scope} key`,
    action: { type: 'site.apiKeys.create', scope } satisfies SiteAction,
    expected: scope === 'full_admin' ? adminOnly : editorOnly,
  })),
  ...MCP_SCOPES.map((scope) => ({
    name: `create ${scope} scope`,
    action: { type: 'site.apiKeys.create', scope: [scope] } satisfies SiteAction,
    expected: editorOnly,
  })),
  { name: 'create empty scopes', action: { type: 'site.apiKeys.create', scope: [] }, expected: nobody },
  { name: 'create all scopes', action: { type: 'site.apiKeys.create', scope: MCP_SCOPES }, expected: editorOnly },
  ...(['me', 'other', null] as const).map((id) => ({
    name: `revoke key created by ${id}`,
    action: { type: 'site.apiKeys.revoke', key: { createdBy: id ? { id } : null }, sessionUserId: 'me' } satisfies SiteAction,
    expected: id === 'me' ? editorOnly : adminOnly,
  })),
];

describe('site access decisions', () => {
  it.each(cases.flatMap(({ name, action, expected }) => roles.map((role, index) => ({ name, role, action, expected: expected[index] }))))(
    '$role: $name → $expected (fresh and stale)',
    ({ role, action, expected }) => {
      for (const stale of [false, true]) {
        const result = decide(ready(role, stale), action);
        expect(result.kind).toBe(expected);
        if (result.kind === 'denied') expect(result.reason).toBeTruthy();
      }
    },
  );

  it.each(cases)('locks unknown access and denies nonmembers: $name', ({ action }) => {
    expect(decide({ status: 'loading' }, action)).toEqual({ kind: 'locked' });
    expect(decide({ status: 'unavailable', retry }, action)).toEqual({ kind: 'locked' });
    expect(decide({ status: 'notMember' }, action)).toEqual({ kind: 'denied', reason: 'access.reason.notMember' });
  });

  it('does not confuse a site Admin with an organization Admin', () => {
    expect(decide({ ...ready('admin'), orgRole: 'member' }, { type: 'site.delete' })).toEqual({
      kind: 'denied',
      reason: 'access.reason.organizationAdmin',
    });
    expect(decide({ ...ready('owner'), orgRole: null }, { type: 'site.ownership.transfer', target: target('admin'), sessionUserId: 'me' })).toEqual({
      kind: 'denied',
      reason: 'access.reason.owner',
    });
  });

  it.each(roles)('keeps API scope and preset decisions aligned with the shared server policy for %s', (role) => {
    for (const scope of MCP_SCOPES) {
      expect(decide(ready(role), { type: 'site.apiKeys.create', scope: [scope] }).kind === 'allowed').toBe(mcpScopesForRole(role).includes(scope));
    }
    for (const scope of MCP_KEY_PRESETS) {
      expect(decide(ready(role), { type: 'site.apiKeys.create', scope }).kind === 'allowed').toBe(roleAtLeast(role, MCP_PRESET_MIN_ROLE[scope]));
    }
  });

  it('uses specific reason keys', () => {
    expect(decide(ready('viewer'), { type: 'site.content.edit' })).toEqual({ kind: 'denied', reason: 'access.viewOnly.action' });
    expect(decide(ready('member'), { type: 'site.settings.manage' })).toEqual({ kind: 'denied', reason: 'settings.permissions.title' });
    expect(decide(ready('owner'), { type: 'site.member.remove', member: { role: 'admin', orgRole: 'admin', viaOrganization: true } })).toEqual({
      kind: 'denied',
      reason: 'access.reason.organizationMember',
    });
    expect(decide(ready('owner'), { type: 'site.ownership.transfer', target: target('member'), sessionUserId: 'me' })).toEqual({
      kind: 'denied',
      reason: 'access.reason.transferTarget',
    });
    expect(decide(ready('viewer'), { type: 'site.apiKeys.create', scope: 'read_only' })).toEqual({
      kind: 'denied',
      reason: 'access.reason.keyScope',
    });
    expect(decide(ready('member'), { type: 'site.apiKeys.revoke', key: { createdBy: null }, sessionUserId: 'me' })).toEqual({
      kind: 'denied',
      reason: 'access.reason.keyOwner',
    });
  });
});

describe('siteAccessFromMembers', () => {
  const input = {
    members: [{ user: { id: 'me' }, role: 'admin', orgRole: 'member' }],
    sessionUserId: 'me',
    pending: false,
    failed: false,
    cachedData: true,
    retry,
  };

  it('trusts the effective site role without recomputing from the organization role', () => {
    expect(siteAccessFromMembers(input)).toEqual({ status: 'ready', role: 'admin', orgRole: 'member', stale: false, retry });
  });
  it.each([
    [{ pending: true }, { status: 'loading' }],
    [{ sessionUserId: undefined }, { status: 'loading' }],
    [{ members: undefined, cachedData: false }, { status: 'loading' }],
    [
      { members: undefined, cachedData: false, failed: true },
      { status: 'unavailable', retry },
    ],
    [
      { pending: true, cachedData: false, failed: true },
      { status: 'unavailable', retry },
    ],
    [{ failed: true }, { status: 'ready', role: 'admin', orgRole: 'member', stale: true, retry }],
    [{ members: [] }, { status: 'notMember' }],
    [{ sessionUserId: 'other' }, { status: 'notMember' }],
    [{ members: [], failed: true }, { status: 'notMember' }],
    [{ members: [{ user: { id: 'me' }, role: 'unknown' }] }, { status: 'notMember' }],
    [{ members: [{ user: { id: 'me' }, role: 'member' }] }, { status: 'ready', role: 'member', orgRole: null, stale: false, retry }],
  ])('builds explicit state for %j', (change, expected) => {
    expect(siteAccessFromMembers({ ...input, ...change })).toEqual(expected);
  });

  it('preserves the retry callback', () => {
    const access = siteAccessFromMembers({ ...input, failed: true, cachedData: false });
    if (access.status !== 'unavailable') throw new Error('Expected unavailable');
    access.retry();
    expect(retry).toHaveBeenCalledOnce();
  });
});
