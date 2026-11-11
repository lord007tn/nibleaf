import { describe, expect, it } from 'vitest';
import {
  emailDomainsProblem,
  emailDomainsValues,
  filterReaders,
  hasAccess,
  inviteProblem,
  inviteRequest,
  MAX_EMAIL_DOMAINS,
  MAX_INVITES,
  pageGroups,
  parseDomainList,
  parseEmailList,
  type ReaderLike,
  readerActivity,
  readerGroupNames,
  readerName,
  readerStatus,
} from './readers';

const reader = (patch: Partial<ReaderLike> = {}): ReaderLike => ({
  id: 'r1',
  email: 'ana@example.com',
  name: null,
  status: 'INVITED',
  createdAt: '2026-11-01T00:00:00.000Z',
  activatedAt: null,
  revokedAt: null,
  lastSeenAt: null,
  audiences: [],
  ...patch,
});

describe('reading lists', () => {
  it('reads addresses and domains from comma, semicolon or newline separated text', () => {
    expect(parseEmailList(' Ana@Example.com,\nsam@example.com; ana@example.com ')).toEqual(['ana@example.com', 'sam@example.com']);
    expect(parseDomainList('@Partner.Example, b.example\nb.example')).toEqual(['partner.example', 'b.example']);
    expect(parseEmailList(' ,; ')).toEqual([]);
  });

  it('sends one address alone (its link comes back) and several together, with the chosen group', () => {
    expect(inviteRequest({ emails: ' Lee@Example.com ', audienceId: '' })).toEqual({ kind: 'one', email: 'lee@example.com', audienceIds: [] });
    expect(inviteRequest({ emails: 'a@example.com\nb@example.com', audienceId: 'g1' })).toEqual({
      kind: 'many',
      emails: ['a@example.com', 'b@example.com'],
      audienceIds: ['g1'],
    });
  });
});

describe('checking invitations', () => {
  it('asks for at least one address', () => {
    expect(inviteProblem('  ')).toEqual({ key: 'settings.visibility.invite.empty' });
  });

  it('refuses more than the server takes at once', () => {
    const many = Array.from({ length: MAX_INVITES + 1 }, (_, index) => `p${index}@example.com`).join(',');
    expect(inviteProblem(many)).toEqual({ key: 'settings.visibility.invite.tooMany' });
  });

  it('names the addresses with a typo, five at most', () => {
    expect(inviteProblem('a@example.com, b@example')).toEqual({ key: 'settings.visibility.invite.invalid', params: { emails: 'b@example' } });
    const typos = Array.from({ length: 7 }, (_, index) => `p${index}@x`).join(',');
    expect(inviteProblem(typos)?.params?.emails?.split(', ')).toHaveLength(5);
    expect(inviteProblem('a@example.com\nb@example.com')).toBeUndefined();
  });
});

describe('checking allowed domains', () => {
  it('accepts domains, with or without a leading @, and an empty list', () => {
    expect(emailDomainsProblem('@Partner.Example, acme.com')).toBeUndefined();
    expect(emailDomainsProblem('')).toBeUndefined();
  });

  it('names what is not a domain', () => {
    expect(emailDomainsProblem('not a domain')).toEqual({ key: 'settings.visibility.domains.invalid', params: { domains: 'not, a, domain' } });
  });

  it('names the domains over the limit when every one is valid', () => {
    const domains = Array.from({ length: MAX_EMAIL_DOMAINS + 1 }, (_, index) => `d${index}.example`).join(',');
    expect(emailDomainsProblem(domains)).toEqual({
      key: 'settings.visibility.domains.invalid',
      params: { domains: `d${MAX_EMAIL_DOMAINS}.example` },
    });
  });

  it('refuses a public email provider, like the server', () => {
    expect(emailDomainsProblem('acme.com, Gmail.com')).toEqual({
      key: 'settings.visibility.domains.publicProvider',
      params: { domain: 'gmail.com' },
    });
  });

  it('shows the stored list as one line', () => {
    expect(emailDomainsValues(['a.example', 'b.example'])).toEqual({ domains: 'a.example, b.example' });
  });
});

describe('the reader list', () => {
  it('badges each status, reading an unknown one as Invited', () => {
    expect(readerStatus({ status: 'ACTIVE' })).toEqual({ label: 'settings.authentication.reader.status.active', tone: 'success' });
    expect(readerStatus({ status: 'REVOKED' }).label).toBe('settings.authentication.reader.status.revoked');
    expect(readerStatus({ status: 'SOMETHING' }).label).toBe('settings.visibility.status.invited');
  });

  it('offers resend and remove only while the reader has access', () => {
    expect(hasAccess({ status: 'INVITED' })).toBe(true);
    expect(hasAccess({ status: 'ACTIVE' })).toBe(true);
    expect(hasAccess({ status: 'REVOKED' })).toBe(false);
  });

  it('names a reader by name, then address, and leaves a portal reader without either to the caller', () => {
    expect(readerName({ name: 'Sam', email: 'sam@example.com' })).toBe('Sam');
    expect(readerName({ name: null, email: 'sam@example.com' })).toBe('sam@example.com');
    expect(readerName({ name: null, email: null })).toBeNull();
  });

  it('says when access was removed, or when they were invited and last read', () => {
    expect(readerActivity(reader({ status: 'REVOKED', revokedAt: '2026-11-05T00:00:00.000Z' }))).toEqual({
      kind: 'revoked',
      at: '2026-11-05T00:00:00.000Z',
    });
    expect(readerActivity(reader())).toEqual({ kind: 'invited', invitedAt: '2026-11-01T00:00:00.000Z', lastSeenAt: null });
    // Never read since, but signed in once: that counts as the last read.
    expect(readerActivity(reader({ activatedAt: '2026-11-02T00:00:00.000Z' }))).toEqual({
      kind: 'invited',
      invitedAt: '2026-11-01T00:00:00.000Z',
      lastSeenAt: '2026-11-02T00:00:00.000Z',
    });
    expect(readerActivity(reader({ activatedAt: '2026-11-02T00:00:00.000Z', lastSeenAt: '2026-11-03T00:00:00.000Z' }))).toMatchObject({
      lastSeenAt: '2026-11-03T00:00:00.000Z',
    });
  });

  it('lists only page-limited groups, and the ones a reader is in', () => {
    const groups = pageGroups([
      { id: 'site', name: 'Everyone', grants: [{ pageId: null }], _count: { readers: 1 } },
      { id: 'g1', name: 'Pilot', grants: [{ pageId: 'p1' }], _count: { readers: 1 } },
    ]);
    expect(groups.map((group) => group.id)).toEqual(['g1']);
    const member = reader({ audiences: [{ audience: { id: 'site', name: 'Everyone' } }, { audience: { id: 'g1', name: 'Pilot' } }] });
    expect(readerGroupNames(member, groups)).toEqual(['Pilot']);
  });

  it('searches names and addresses, ignoring case and surrounding spaces', () => {
    const readers = [reader({ id: 'a', name: 'Ana' }), reader({ id: 'b', email: 'sam@acme.com' })];
    expect(filterReaders(readers, '  ').map((item) => item.id)).toEqual(['a', 'b']);
    expect(filterReaders(readers, ' ACME ').map((item) => item.id)).toEqual(['b']);
    expect(filterReaders(readers, 'ana').map((item) => item.id)).toEqual(['a']);
  });
});
