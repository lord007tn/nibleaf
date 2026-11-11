/**
 * Site settings → Visibility & access → readers, as pure logic: how invited
 * addresses and allowed email domains are read and checked, how each reader
 * is described, and how the list is searched. Rendered by
 * `components/readers-section.tsx`; tested in `readers.test.ts`.
 */
import type { MessageKey } from '@nibleaf/i18n';
import { isPublicEmailProvider } from '@nibleaf/shared/email-providers';

/** The most addresses one invitation request takes (the server's limit). */
export const MAX_INVITES = 100;
/** The most allowed email domains a site keeps (the server's limit). */
export const MAX_EMAIL_DOMAINS = 20;
/** The reader list gets a search field once it is longer than this. */
export const READER_SEARCH_THRESHOLD = 8;
/** How many bad entries an error message names before it stops listing them. */
const NAMED_IN_ERROR = 5;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A message to show, with its parameters. */
export type Problem = { key: MessageKey; params?: Record<string, string> };

/** Addresses from a comma, semicolon or newline separated field, lowercased and once each. */
export const parseEmailList = (value: string): string[] => [
  ...new Set(
    value
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  ),
];

/** Domains from a comma or newline separated field, lowercased, without a leading @. */
export const parseDomainList = (value: string): string[] => [
  ...new Set(
    value
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
  ),
];

/** What is wrong with the addresses typed into the invite field, if anything. Checked on submit. */
export function inviteProblem(value: string): Problem | undefined {
  const emails = parseEmailList(value);
  if (emails.length === 0) return { key: 'settings.visibility.invite.empty' };
  if (emails.length > MAX_INVITES) return { key: 'settings.visibility.invite.tooMany' };
  const invalid = emails.filter((email) => !EMAIL.test(email));
  return invalid.length ? { key: 'settings.visibility.invite.invalid', params: { emails: invalid.slice(0, NAMED_IN_ERROR).join(', ') } } : undefined;
}

/**
 * What is wrong with the allowed email domains, if anything. Checked on
 * submit. A free webmail domain is refused like the server does, since it
 * would let anyone in.
 */
export function emailDomainsProblem(value: string): Problem | undefined {
  const domains = parseDomainList(value);
  const invalid = domains.filter((domain) => !DOMAIN.test(domain));
  if (domains.length > MAX_EMAIL_DOMAINS || invalid.length) {
    const named = invalid.length ? invalid.slice(0, NAMED_IN_ERROR) : domains.slice(MAX_EMAIL_DOMAINS);
    return { key: 'settings.visibility.domains.invalid', params: { domains: named.join(', ') } };
  }
  const publicProvider = domains.find(isPublicEmailProvider);
  return publicProvider ? { key: 'settings.visibility.domains.publicProvider', params: { domain: publicProvider } } : undefined;
}

/** The allowed-domains form's value: the server's list as one editable line. */
export const emailDomainsValues = (domains: readonly string[]) => ({ domains: domains.join(', ') });

/** What the invite form sends: one address goes alone (its link comes back to share), several go together. */
export function inviteRequest(value: {
  emails: string;
  audienceId: string;
}): { kind: 'one'; email: string; audienceIds: string[] } | { kind: 'many'; emails: string[]; audienceIds: string[] } {
  const emails = parseEmailList(value.emails);
  const audienceIds = value.audienceId ? [value.audienceId] : [];
  const [first] = emails;
  return emails.length === 1 && first ? { kind: 'one', email: first, audienceIds } : { kind: 'many', emails, audienceIds };
}

// ─── The reader list ────────────────────────────────────────────────────────

/** The fields of a reader this model reads (a structural copy of the API's reader). */
export type ReaderLike = {
  id: string;
  email: string | null;
  name: string | null;
  status: string;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  audiences: ReadonlyArray<{ audience: { id: string; name: string } }>;
};

export type AudienceLike = { id: string; name: string; grants: ReadonlyArray<{ pageId: string | null }>; _count: { readers: number } };

type ReaderTone = 'success' | 'info' | 'neutral';

const INVITED: { label: MessageKey; tone: ReaderTone } = { label: 'settings.visibility.status.invited', tone: 'info' };
const READER_STATUS: Record<string, { label: MessageKey; tone: ReaderTone }> = {
  ACTIVE: { label: 'settings.authentication.reader.status.active', tone: 'success' },
  INVITED,
  REVOKED: { label: 'settings.authentication.reader.status.revoked', tone: 'neutral' },
};

/** The reader's status badge. An unknown status reads as Invited, as before. */
export const readerStatus = (reader: Pick<ReaderLike, 'status'>) => READER_STATUS[reader.status] ?? INVITED;

/** Whether the reader still has access, and so can be sent the invitation again or removed. */
export const hasAccess = (reader: Pick<ReaderLike, 'status'>) => reader.status !== 'REVOKED';

/** The name a reader goes by: their name, then their address; `null` for a portal reader with neither. */
export const readerName = (reader: Pick<ReaderLike, 'name' | 'email'>) => reader.name || reader.email || null;

/**
 * What the reader's meta line says: when access was removed, or when they were
 * invited and when they last read (falling back to when they first signed in).
 */
export type ReaderActivity = { kind: 'revoked'; at: string } | { kind: 'invited'; invitedAt: string; lastSeenAt: string | null };

export function readerActivity(reader: ReaderLike): ReaderActivity {
  if (reader.status === 'REVOKED' && reader.revokedAt) return { kind: 'revoked', at: reader.revokedAt };
  return { kind: 'invited', invitedAt: reader.createdAt, lastSeenAt: reader.lastSeenAt ?? reader.activatedAt };
}

/** An audience limited to some pages, as opposed to one that covers the whole site. */
const isPageGroup = (audience: Pick<AudienceLike, 'grants'>) => !audience.grants.some((grant) => grant.pageId === null);

/** The page-limited groups a reader can be invited to (the whole site is the default). */
export const pageGroups = <A extends Pick<AudienceLike, 'grants'>>(audiences: readonly A[]): A[] => audiences.filter(isPageGroup);

/** The page groups a reader belongs to, by name, for their meta line. */
export function readerGroupNames(reader: Pick<ReaderLike, 'audiences'>, groups: ReadonlyArray<{ id: string }>): string[] {
  const ids = new Set(groups.map((group) => group.id));
  return reader.audiences
    .map((item) => item.audience)
    .filter((audience) => ids.has(audience.id))
    .map((audience) => audience.name);
}

/** Readers whose name or address contains the search text, ignoring case. */
export function filterReaders<R extends Pick<ReaderLike, 'name' | 'email'>>(readers: readonly R[], query: string): readonly R[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return readers;
  return readers.filter((reader) => `${reader.name ?? ''} ${reader.email ?? ''}`.toLowerCase().includes(needle));
}
