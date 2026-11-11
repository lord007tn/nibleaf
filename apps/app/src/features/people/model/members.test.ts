import { describe, expect, it } from 'vitest';
import { accessChange, filterRows, memberRows, NO_FILTERS, type OrgMemberRecord, selectionFromGrants, websiteAccess } from './members';
import { initialsFor, matchesQuery, personDisplay } from './person';

const grant = (projectId: string, name: string, role = 'member') => ({ projectId, role, project: { id: projectId, name } });
const record = (over: Partial<OrgMemberRecord> & { name?: string; email?: string }): OrgMemberRecord => ({
  id: over.id ?? `m-${over.email}`,
  userId: over.userId ?? `u-${over.email}`,
  orgRole: over.orgRole ?? 'member',
  createdAt: '2026-11-01T00:00:00.000Z',
  user: { id: `u-${over.email}`, name: over.name ?? '', email: over.email ?? 'x@example.test', image: null },
  projectGrants: over.projectGrants ?? [],
});

describe('person display', () => {
  it('uses initials from the name, else from the email, never a placeholder', () => {
    expect(initialsFor('Lina Mansour', 'lina@example.test')).toBe('LM');
    expect(initialsFor('', 'lina.mansour@example.test')).toBe('LM');
    expect(initialsFor(null, 'ziad@example.test')).toBe('ZI');
    expect(initialsFor('سارة حداد', 's@example.test')).toBe('سح');
  });
  it('puts the email first for a nameless person, with no empty second line', () => {
    expect(personDisplay({ name: '', email: 'u@example.test' })).toEqual({ primary: 'u@example.test', secondary: null, initials: 'U' });
    expect(personDisplay({ name: 'Omar', email: 'omar@example.test' }).secondary).toBe('omar@example.test');
  });
  it('matches ignoring case and accents', () => {
    expect(matchesQuery('LINA', 'Lína M.')).toBe(true);
    expect(matchesQuery('acme', null, 'z@acme.com')).toBe(true);
    expect(matchesQuery('nope', 'Lina')).toBe(false);
  });
});

describe('member rows', () => {
  const members = [
    record({ email: 'zed@example.test', name: 'Zed' }),
    record({ email: 'owner@example.test', name: 'Sara', orgRole: 'owner' }),
    record({ email: 'amir@example.test', name: 'Amir', orgRole: 'admin' }),
    record({ email: 'lina@example.test', name: 'Lina', projectGrants: [grant('p2', 'API'), grant('p1', 'Docs', 'viewer'), grant('p3', 'Blog')] }),
  ];
  it('orders Owner, Admins, then Members by name, and marks you', () => {
    const rows = memberRows(members, 'u-amir@example.test');
    expect(rows.map((row) => row.person.primary)).toEqual(['Sara', 'Amir', 'Lina', 'Zed']);
    expect(rows.find((row) => row.isYou)?.person.primary).toBe('Amir');
  });
  it('summarizes website access: all, none, or chips with +N', () => {
    expect(websiteAccess(members[1] as OrgMemberRecord)).toEqual({ kind: 'all' });
    expect(websiteAccess(members[0] as OrgMemberRecord)).toEqual({ kind: 'none' });
    const some = websiteAccess(members[3] as OrgMemberRecord);
    expect(some.kind === 'some' && some.chips.map((chip) => chip.name)).toEqual(['API', 'Blog']);
    expect(some.kind === 'some' && some.overflow).toBe(1);
  });
  it('filters by search, role and website (Owner/Admins open every website)', () => {
    const rows = memberRows(members, undefined);
    expect(filterRows(rows, { ...NO_FILTERS, query: 'lin' }).map((r) => r.person.primary)).toEqual(['Lina']);
    expect(filterRows(rows, { ...NO_FILTERS, role: 'admin' }).map((r) => r.person.primary)).toEqual(['Amir']);
    expect(filterRows(rows, { ...NO_FILTERS, website: 'p1' }).map((r) => r.person.primary)).toEqual(['Sara', 'Amir', 'Lina']);
  });
});

describe('access changes', () => {
  const before = { orgRole: 'member', selection: selectionFromGrants([{ projectId: 'p1', role: 'member' }]) };
  it('sends nothing when nothing changed', () => {
    expect(accessChange(before, { orgRole: 'member', selection: { p1: 'member' } })).toEqual({ kind: 'none' });
  });
  it('replaces the website set for a Member, including none', () => {
    expect(accessChange(before, { orgRole: 'member', selection: { p1: 'viewer', p2: 'admin' } })).toEqual({
      kind: 'access',
      grants: [
        { projectId: 'p1', role: 'viewer' },
        { projectId: 'p2', role: 'admin' },
      ],
    });
    expect(accessChange(before, { orgRole: 'member', selection: {} })).toEqual({ kind: 'access', grants: [] });
  });
  it('promotes without a website list and demotes with exactly the chosen websites', () => {
    expect(accessChange(before, { orgRole: 'admin', selection: {} })).toEqual({ kind: 'role', orgRole: 'admin' });
    expect(accessChange({ orgRole: 'admin', selection: { p1: 'member' } }, { orgRole: 'member', selection: {} })).toEqual({
      kind: 'role',
      orgRole: 'member',
      grants: [],
    });
  });
});
