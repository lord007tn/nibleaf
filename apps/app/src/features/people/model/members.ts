import { matchesQuery, type PersonDisplay, personDisplay } from './person';
import { isOrgAdminRole, orgRoleOrder, type SiteRole } from './roles';

/** A website grant as the org Members list returns it. */
interface MemberGrant {
  projectId: string;
  role: string;
  project: { id: string; name: string };
}
export interface OrgMemberRecord {
  id: string;
  userId: string;
  orgRole: string;
  createdAt: string;
  lastActiveAt?: string | null;
  user: { id: string; name: string; email: string; image: string | null };
  projectGrants: MemberGrant[];
}

/** One website chip: the name and the role there. */
interface WebsiteChip {
  projectId: string;
  name: string;
  role: string;
}
/**
 * What the Websites column shows: Owner/Admins open everything ("All
 * websites"), a Member their grants (a few chips, then "+N"), or nothing yet.
 */
export type WebsiteAccess = { kind: 'all' } | { kind: 'none' } | { kind: 'some'; chips: WebsiteChip[]; overflow: number; all: WebsiteChip[] };

export function websiteAccess(member: Pick<OrgMemberRecord, 'orgRole' | 'projectGrants'>, visible = 2): WebsiteAccess {
  if (isOrgAdminRole(member.orgRole)) return { kind: 'all' };
  const all = member.projectGrants
    .map((grant) => ({ projectId: grant.projectId, name: grant.project.name, role: grant.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!all.length) return { kind: 'none' };
  return { kind: 'some', chips: all.slice(0, visible), overflow: Math.max(0, all.length - visible), all };
}

export interface MemberRow {
  member: OrgMemberRecord;
  person: PersonDisplay;
  isYou: boolean;
  access: WebsiteAccess;
}

/** Owner first, then Admins, then Members; by name (or email) within each. */
export function memberRows(members: OrgMemberRecord[], viewerUserId: string | undefined): MemberRow[] {
  return members
    .map((member) => ({ member, person: personDisplay(member.user), isYou: member.userId === viewerUserId, access: websiteAccess(member) }))
    .sort(
      (a, b) =>
        orgRoleOrder(a.member.orgRole) - orgRoleOrder(b.member.orgRole) ||
        a.person.primary.localeCompare(b.person.primary, undefined, { sensitivity: 'base' }),
    );
}

export interface MemberFilters {
  query: string;
  /** An org role, or 'all'. */
  role: string;
  /** A website id, or 'all'. A website filter keeps everyone who can open it (Owner/Admins included). */
  website: string;
}
export const NO_FILTERS: MemberFilters = { query: '', role: 'all', website: 'all' };
export const hasFilters = (filters: MemberFilters) => filters.query.trim() !== '' || filters.role !== 'all' || filters.website !== 'all';

export function filterRows(rows: MemberRow[], filters: MemberFilters): MemberRow[] {
  return rows.filter(({ member, access }) => {
    if (!matchesQuery(filters.query, member.user.name, member.user.email)) return false;
    if (filters.role !== 'all' && member.orgRole !== filters.role) return false;
    if (
      filters.website !== 'all' &&
      access.kind !== 'all' &&
      !(access.kind === 'some' && access.all.some((chip) => chip.projectId === filters.website))
    )
      return false;
    return true;
  });
}

/** A website checklist value: which websites, at which role. */
export type GrantSelection = Record<string, SiteRole>;

export const selectionFromGrants = (grants: Array<{ projectId: string; role: string }>): GrantSelection =>
  Object.fromEntries(
    grants
      .filter((grant) => grant.role === 'admin' || grant.role === 'member' || grant.role === 'viewer')
      .map((grant) => [grant.projectId, grant.role as SiteRole]),
  );
export const grantsFromSelection = (selection: GrantSelection) =>
  Object.entries(selection)
    .map(([projectId, role]) => ({ projectId, role }))
    .sort((a, b) => a.projectId.localeCompare(b.projectId));
const sameSelection = (a: GrantSelection, b: GrantSelection) => JSON.stringify(grantsFromSelection(a)) === JSON.stringify(grantsFromSelection(b));

/** What saving the access sheet sends: an org role change (with the website set when it ends as Member), a website set, or nothing. */
export type AccessChange =
  | { kind: 'none' }
  | { kind: 'role'; orgRole: 'admin' | 'member'; grants?: Array<{ projectId: string; role: SiteRole }> }
  | { kind: 'access'; grants: Array<{ projectId: string; role: SiteRole }> };

export function accessChange(
  before: { orgRole: string; selection: GrantSelection },
  after: { orgRole: 'admin' | 'member'; selection: GrantSelection },
): AccessChange {
  if (before.orgRole !== after.orgRole)
    return after.orgRole === 'member'
      ? { kind: 'role', orgRole: 'member', grants: grantsFromSelection(after.selection) }
      : { kind: 'role', orgRole: 'admin' };
  if (after.orgRole === 'member' && !sameSelection(before.selection, after.selection))
    return { kind: 'access', grants: grantsFromSelection(after.selection) };
  return { kind: 'none' };
}
