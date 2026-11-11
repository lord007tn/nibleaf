import { describe, expect, it } from 'vitest';
import { hasEverything, type InvitationInfo, invitationState, type JoinPreview, joinState } from './admission';

const info = (over: Partial<InvitationInfo> = {}): InvitationInfo => ({
  id: 'inv',
  email: 'lina@example.test',
  orgRole: 'member',
  organizationId: 'org',
  organizationName: 'Acme',
  inviterName: 'Sara',
  grants: [{ projectId: 'p1', name: 'Docs', role: 'member' }],
  status: 'pending',
  expired: false,
  ...over,
});
const base = { pending: false, errorStatus: null, session: { email: 'lina@example.test' }, memberships: [] };

describe('accept-invitation states (design §6.3)', () => {
  it('shows one honest state for unknown, revoked, failed and expired invitations', () => {
    expect(invitationState({ ...base, info: null, errorStatus: 404 }).kind).toBe('invalid');
    expect(invitationState({ ...base, info: null, errorStatus: 500 }).kind).toBe('error');
    expect(invitationState({ ...base, info: info({ expired: true }) }).kind).toBe('expired');
    expect(invitationState({ ...base, pending: true, info: null }).kind).toBe('loading');
  });
  it('offers "Open" on a used invitation only to a current member', () => {
    const member = { id: 'org', slug: 'acme', orgRole: 'member' };
    expect(invitationState({ ...base, info: info({ status: 'accepted' }), memberships: [member] })).toMatchObject({
      kind: 'used',
      membership: member,
    });
    expect(invitationState({ ...base, info: info({ status: 'accepted' }) })).toMatchObject({ kind: 'used', membership: null });
    expect(invitationState({ ...base, session: null, info: info({ status: 'accepted' }), memberships: [member] })).toMatchObject({
      membership: null,
    });
  });
  it('asks a signed-out visitor to sign in, and a different account to switch', () => {
    expect(invitationState({ ...base, session: null, info: info() }).kind).toBe('signedOut');
    expect(invitationState({ ...base, session: { email: 'b@example.test' }, info: info() })).toMatchObject({
      kind: 'wrongAccount',
      signedInAs: 'b@example.test',
    });
  });
  it('explains what changes for someone already in the organization', () => {
    expect(invitationState({ ...base, info: info() })).toMatchObject({ kind: 'ready', note: 'none' });
    const as = (orgRole: string) => [{ id: 'org', slug: 'acme', orgRole }];
    expect(invitationState({ ...base, info: info(), memberships: as('member') })).toMatchObject({ note: 'alreadyMember' });
    expect(invitationState({ ...base, info: info({ orgRole: 'admin' }), memberships: as('member') })).toMatchObject({ note: 'becomeAdmin' });
    expect(invitationState({ ...base, info: info(), memberships: as('owner') })).toMatchObject({ note: 'alreadyEverything' });
  });
});

describe('join-link states (design §6.4)', () => {
  const preview = (over: Partial<JoinPreview> = {}): JoinPreview => ({
    organizationId: 'org',
    organizationName: 'Acme',
    inviterName: 'Sara',
    grants: [{ projectId: 'p1', name: 'Docs', role: 'viewer' }],
    allowedDomain: null,
    ...over,
  });
  const join = { pending: false, errorStatus: null, session: { email: 'lina@example.test' }, memberships: [], siteRoles: null };
  it('tells the owner (or anyone with the access) they are already a member, with where to go', () => {
    const owner = [{ id: 'org', slug: 'acme', orgRole: 'owner' }];
    expect(joinState({ ...join, preview: preview(), memberships: owner })).toEqual({
      kind: 'alreadyMember',
      preview: preview(),
      landing: { projectId: 'p1' },
    });
    const member = [{ id: 'org', slug: 'acme', orgRole: 'member' }];
    expect(joinState({ ...join, preview: preview(), memberships: member, siteRoles: { p1: 'member' } }).kind).toBe('alreadyMember');
    expect(joinState({ ...join, preview: preview(), memberships: member, siteRoles: {} })).toMatchObject({ kind: 'ready', note: 'alreadyMember' });
    expect(joinState({ ...join, preview: preview(), memberships: member, siteRoles: null }).kind).toBe('loading');
  });
  it('says up front when the address is outside the allowed domain', () => {
    expect(joinState({ ...join, preview: preview({ allowedDomain: 'acme.com' }) })).toMatchObject({ kind: 'wrongDomain' });
    expect(joinState({ ...join, session: { email: 'lina@ACME.com' }, preview: preview({ allowedDomain: 'acme.com' }) }).kind).toBe('ready');
  });
  it('one invalid state for every unusable link', () => {
    expect(joinState({ ...join, preview: null, errorStatus: 404 }).kind).toBe('invalid');
    expect(joinState({ ...join, preview: null, errorStatus: 503 }).kind).toBe('error');
    expect(joinState({ ...join, session: null, preview: preview() }).kind).toBe('signedOut');
  });
  it('compares grants by rank', () => {
    expect(hasEverything([{ projectId: 'p1', role: 'member' }], 'member', { p1: 'admin' })).toBe(true);
    expect(hasEverything([{ projectId: 'p1', role: 'admin' }], 'member', { p1: 'member' })).toBe(false);
    expect(hasEverything([{ projectId: 'p1', role: 'admin' }], null, {})).toBe(false);
  });
});
