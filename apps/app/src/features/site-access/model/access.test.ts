import type { MemberRole } from '@nibleaf/shared/constants';
import { MCP_KEY_PRESETS, MCP_PRESET_MIN_ROLE, MCP_SCOPES, mcpScopesForRole } from '@nibleaf/shared/mcp';
import { canAdminister, canAssignRole, effectiveSiteRole, type OrgRole, roleAtLeast } from '@nibleaf/shared/rbac';
import { createApiKeyBody } from '@nibleaf/validators';
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

/**
 * Parity with the server for the cases where the site role and the
 * organization role differ. `ready()` above derives one from the other; these
 * build the member row the server sends (role = effectiveSiteRole(orgRole,
 * grant), apps/server/src/actions/members.ts `siteActor`) and go through
 * `siteAccessFromMembers`, as the app does.
 */
describe('site access from the organization and the site grant', () => {
  const me = 'me';
  /** What the members list says about the signed-in person, or nothing when the server leaves them out. */
  const accessFor = (orgRole: OrgRole, grant: 'admin' | 'member' | 'viewer' | null) => {
    const role = effectiveSiteRole(orgRole, grant);
    return siteAccessFromMembers({
      members: role ? [{ user: { id: me }, role, orgRole }] : [],
      sessionUserId: me,
      pending: false,
      failed: false,
      cachedData: true,
      retry,
    });
  };
  // The server's own rules, restated from apps/server: website settings and
  // members need the effective site Admin role; deleting the website and
  // transferring ownership go by the organization role.
  const server = (orgRole: OrgRole, grant: 'admin' | 'member' | 'viewer' | null) => {
    const role = effectiveSiteRole(orgRole, grant);
    return {
      settings: Boolean(role) && canAdminister(role ?? ''),
      delete: canAdminister(orgRole),
      transfer: orgRole === 'owner',
    };
  };
  const scenarios = [
    { name: 'inherited Owner, no grant', orgRole: 'owner', grant: null },
    { name: 'inherited Admin, no grant', orgRole: 'admin', grant: null },
    { name: 'site-only Admin', orgRole: 'member', grant: 'admin' },
    { name: 'site Member', orgRole: 'member', grant: 'member' },
    { name: 'site Viewer', orgRole: 'member', grant: 'viewer' },
    { name: 'organization Member with no grant', orgRole: 'member', grant: null },
  ] as const;

  it.each(scenarios)('$name: settings, delete and transfer match the server', ({ orgRole, grant }) => {
    const access = accessFor(orgRole, grant);
    const expected = server(orgRole, grant);
    expect(decide(access, { type: 'site.settings.manage' }).kind === 'allowed').toBe(expected.settings);
    expect(decide(access, { type: 'site.members.manage' }).kind === 'allowed').toBe(expected.settings);
    expect(decide(access, { type: 'site.delete' }).kind === 'allowed').toBe(expected.delete);
    expect(decide(access, { type: 'site.ownership.transfer', target: target('admin'), sessionUserId: me }).kind === 'allowed').toBe(
      expected.transfer,
    );
  });

  it('treats an organization Member with no grant as not on the site, with that reason', () => {
    const access = accessFor('member', null);
    expect(access).toEqual({ status: 'notMember' });
    expect(decide(access, { type: 'site.content.edit' })).toEqual({ kind: 'denied', reason: 'access.reason.notMember' });
  });

  it('keeps the organization role for an inherited Admin even though no grant exists', () => {
    expect(accessFor('admin', null)).toEqual({ status: 'ready', role: 'admin', orgRole: 'admin', stale: false, retry });
  });

  // Server: removeMember lets a site Admin remove a site-only member, themselves
  // included, and refuses anyone with access via the organization.
  it('lets a site-only Admin remove themselves, and refuses it for an inherited Admin', () => {
    const selfRow = (orgRole: OrgRole, grant: 'admin' | null) => ({
      role: effectiveSiteRole(orgRole, grant) ?? 'viewer',
      orgRole,
      viaOrganization: orgRole !== 'member',
    });
    expect(decide(accessFor('member', 'admin'), { type: 'site.member.remove', member: selfRow('member', 'admin') }).kind).toBe('allowed');
    expect(decide(accessFor('admin', null), { type: 'site.member.remove', member: selfRow('admin', null) })).toEqual({
      kind: 'denied',
      reason: 'access.reason.organizationMember',
    });
  });

  // Server: updateMemberRole lets a site Admin assign any role up to their own
  // (canAssignRole), themselves included; the members UI gates the change with
  // `site.members.manage` and refuses organization-managed rows like removal.
  it('lets a site-only Admin demote themselves, as the server does', () => {
    expect(decide(accessFor('member', 'admin'), { type: 'site.members.manage' }).kind).toBe('allowed');
    expect(canAssignRole('admin', 'member')).toBe(true);
    expect(canAssignRole('admin', 'owner')).toBe(false);
  });
});

describe('custom API key scopes', () => {
  const body = (scopes: string[]) => createApiKeyBody.safeParse({ name: 'Agent', scopes });

  it('decides eligibility only: a scope without mcp:connect is eligible but refused by the request schema', () => {
    expect(decide(ready('member'), { type: 'site.apiKeys.create', scope: ['pages:read'] }).kind).toBe('allowed');
    expect(body(['pages:read']).success).toBe(false);
  });

  it('accepts a complete selection in both', () => {
    expect(decide(ready('member'), { type: 'site.apiKeys.create', scope: ['mcp:connect', 'pages:read'] }).kind).toBe('allowed');
    expect(body(['mcp:connect', 'pages:read']).success).toBe(true);
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
