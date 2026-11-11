import type { RecentWebsite, SwitcherOrganization, SwitcherWebsite } from '@/hooks/api/organization-query-options';

/*
 * Pure switcher logic (design §5.4.1), kept apart from the components so the
 * ordering, search and keyboard rules are unit-tested without a DOM.
 */

export type Pane = 'orgs' | 'websites';

/** Current org first, then the server's order (last opened, recent, oldest membership). */
export const orderOrganizations = (organizations: SwitcherOrganization[], currentId: string | undefined) => {
  const current = organizations.find((org) => org.id === currentId);
  return current ? [current, ...organizations.filter((org) => org.id !== currentId)] : organizations;
};

/** Case- and accent-insensitive match on any of the given fields. */
const fold = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
export const matches = (query: string, ...fields: Array<string | null | undefined>) => {
  const needle = fold(query.trim());
  return needle.length === 0 || fields.some((field) => field && fold(field).includes(needle));
};

export type SearchResult =
  | { kind: 'organization'; id: string; organization: SwitcherOrganization }
  | { kind: 'website'; id: string; website: SwitcherWebsite; organization: Pick<SwitcherOrganization, 'id' | 'slug' | 'name'> };

/**
 * One flat result list for orgs and websites together: organizations first,
 * then websites (each with its org). Websites come from every org list loaded
 * so far plus Recent, de-duplicated by id.
 */
export const searchSwitcher = (
  query: string,
  organizations: SwitcherOrganization[],
  websitesByOrg: ReadonlyMap<string, SwitcherWebsite[]>,
  recent: RecentWebsite[],
): SearchResult[] => {
  const orgResults: SearchResult[] = organizations
    .filter((org) => matches(query, org.name, org.slug))
    .map((organization) => ({ kind: 'organization', id: `org-${organization.id}`, organization }));
  const seen = new Set<string>();
  const websiteResults: SearchResult[] = [];
  const push = (website: SwitcherWebsite, organization: Pick<SwitcherOrganization, 'id' | 'slug' | 'name'>) => {
    if (seen.has(website.id) || !matches(query, website.name, website.domain)) return;
    seen.add(website.id);
    websiteResults.push({ kind: 'website', id: `site-${website.id}`, website, organization });
  };
  for (const org of organizations) for (const website of websitesByOrg.get(org.id) ?? []) push(website, org);
  for (const website of recent) push(website, website.organization);
  return [...orgResults, ...websiteResults];
};

/** Up/Down/Home/End inside one pane. Returns the new index (clamped, no wrap). */
export const moveWithinPane = (key: string, index: number, count: number): number | null => {
  if (count === 0) return null;
  if (key === 'ArrowDown') return Math.min(count - 1, index + 1);
  if (key === 'ArrowUp') return Math.max(0, index - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
};

/**
 * Left/Right between panes. The organizations pane sits at the inline start,
 * so in RTL it is on the right and the arrows mirror: "towards the websites"
 * is ArrowRight in LTR and ArrowLeft in RTL.
 */
export const paneForArrow = (key: string, pane: Pane, direction: 'ltr' | 'rtl'): Pane | null => {
  const towardsEnd = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const towardsStart = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  if (key === towardsEnd && pane === 'orgs') return 'websites';
  if (key === towardsStart && pane === 'websites') return 'orgs';
  return null;
};

/** A key that types text, so it should move focus to the search field. */
export const isTypingKey = (event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>) =>
  event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey;

/** Typing targets never trigger the `G` sequences. */
export const isEditableTarget = (target: EventTarget | null) => {
  if (!target || typeof (target as HTMLElement).closest !== 'function') return false;
  const element = target as HTMLElement;
  return Boolean(element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'));
};

export const SEQUENCE_TIMEOUT_MS = 1200;

/**
 * `G` then `O` opens the organization switcher, `G` then `W` the website
 * switcher (design §5.4.1). Returns a key handler fed with keydown events; it
 * ignores keys typed into fields and any key with a modifier.
 */
export const createSequenceHandler = (actions: { organization: () => void; website: () => void }, now: () => number = Date.now) => {
  let pendingAt: number | null = null;
  return (event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target' | 'defaultPrevented'>): boolean => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) {
      pendingAt = null;
      return false;
    }
    const key = event.key.toLowerCase();
    const armed = pendingAt !== null && now() - pendingAt <= SEQUENCE_TIMEOUT_MS;
    pendingAt = null;
    if (armed && key === 'o') {
      actions.organization();
      return true;
    }
    if (armed && key === 'w') {
      actions.website();
      return true;
    }
    if (key === 'g') pendingAt = now();
    return false;
  };
};

/** Two-letter initials for an org without a logo; first letters of the first two words. */
export const initials = (name: string) => {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const letters = (words.length > 1 ? [words[0], words[1]] : [words[0] ?? '']).map((word) => Array.from(word ?? '')[0] ?? '');
  return letters.join('').toLocaleUpperCase() || '?';
};
