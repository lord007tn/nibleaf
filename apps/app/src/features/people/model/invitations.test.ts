import { describe, expect, it } from 'vitest';
import { emailsError, fieldErrorVisible, invitationTiming, parseEmails } from './invitations';
import { draftNeedsWarning, type JoinLinkDraft, joinLinkBody, joinLinkErrors, linkActions, normalizeDomain } from './join-links';
import { assignableSiteRoles, DEFAULT_INVITE_SITE_ROLE, DEFAULT_JOIN_LINK_SITE_ROLE, orgRoleLabel, SITE_ROLE_OPTIONS, siteRoleLabel } from './roles';

describe('invite emails', () => {
  it('splits on commas, semicolons, spaces and new lines; dedupes; keeps pasted <addresses>', () => {
    expect(parseEmails('a@x.io, b@x.io;\nA@X.io  <c@x.io>  nope')).toEqual({ valid: ['a@x.io', 'b@x.io', 'c@x.io'], invalid: ['nope'] });
  });
  it('has no error on an untouched form until it is required', () => {
    expect(emailsError('')).toEqual({ key: 'people.invite.error.emailsRequired' });
    expect(emailsError('', { single: true })).toEqual({ key: 'people.invite.error.emailRequired' });
    expect(emailsError('a@x.io')).toBeNull();
    expect(emailsError('a@x.io b@', {})).toEqual({ key: 'people.invite.error.invalid', values: { emails: 'b@' } });
    expect(emailsError('a@x.io b@x.io', { single: true })).toEqual({ key: 'people.invite.error.oneAddress' });
  });
  it('shows a field error only after blur or a submit attempt', () => {
    expect(fieldErrorVisible('required', { isBlurred: false }, 0)).toBe(false);
    expect(fieldErrorVisible('required', { isBlurred: true }, 0)).toBe(true);
    expect(fieldErrorVisible('required', { isBlurred: false }, 1)).toBe(true);
    expect(fieldErrorVisible(undefined, { isBlurred: true }, 1)).toBe(false);
  });
  it('counts the days an invitation has left', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(invitationTiming('2026-11-17T12:00:00Z', now)).toEqual({ expired: false, daysLeft: 7 });
    expect(invitationTiming('2026-11-10T11:00:00Z', now)).toEqual({ expired: true, daysLeft: 0 });
  });
});

describe('roles', () => {
  it('defaults invitations to Editor and join links to Viewer', () => {
    expect(DEFAULT_INVITE_SITE_ROLE).toBe('member');
    expect(DEFAULT_JOIN_LINK_SITE_ROLE).toBe('viewer');
  });
  it('offers the assignable site roles least access first, never Owner', () => {
    expect(SITE_ROLE_OPTIONS.map((option) => option.role)).toEqual(['viewer', 'member', 'admin']);
  });
  it('never offers more than your own role', () => {
    expect(assignableSiteRoles('owner')).toEqual(['viewer', 'member', 'admin']);
    expect(assignableSiteRoles('admin')).toEqual(['viewer', 'member', 'admin']);
    expect(assignableSiteRoles('member')).toEqual(['viewer', 'member']);
  });
  it('labels unknown roles as unknown', () => {
    expect(siteRoleLabel('member')).toBe('roles.editor');
    expect(siteRoleLabel('superuser')).toBe('roles.unknown');
    expect(orgRoleLabel('owner')).toBe('people.orgRole.owner');
  });
});

describe('join link drafts', () => {
  const draft = (over: Partial<JoinLinkDraft> = {}): JoinLinkDraft => ({
    label: '',
    grants: { p1: 'viewer' },
    allowedDomain: '',
    maxUses: '',
    expiry: '7',
    ...over,
  });
  it('requires a website and validates the domain and max uses', () => {
    expect(joinLinkErrors(draft())).toEqual({});
    expect(joinLinkErrors(draft({ grants: {}, allowedDomain: 'not a domain', maxUses: '0' }))).toEqual({
      grants: 'people.links.error.website',
      allowedDomain: 'people.links.error.domain',
      maxUses: 'people.links.error.maxUses',
    });
    expect(normalizeDomain(' @ACME.com ')).toBe('acme.com');
  });
  it('builds the request body', () => {
    expect(joinLinkBody(draft({ label: ' Support ', allowedDomain: '@acme.com', maxUses: '10', expiry: 'never' }))).toEqual({
      label: 'Support',
      grants: [{ projectId: 'p1', role: 'viewer' }],
      allowedDomain: 'acme.com',
      maxUses: 10,
      expiresInDays: null,
    });
  });
  it('warns for Editor or Admin through a link, and only deletes inactive links', () => {
    expect(draftNeedsWarning({ grants: { p1: 'viewer' } })).toBe(false);
    expect(draftNeedsWarning({ grants: { p1: 'viewer', p2: 'member' } })).toBe(true);
    expect(linkActions('active')).toEqual({ regenerate: true, disable: true, delete: false });
    expect(linkActions('revoked').delete).toBe(true);
  });
});
