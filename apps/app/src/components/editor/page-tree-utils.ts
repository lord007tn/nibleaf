import { type MessageKey, resolveLocale, translateFn } from '@nibleaf/i18n';
import { pageStructureRevisionSource } from '@nibleaf/shared/page-moves';
import { slugifyUnicode } from '@nibleaf/shared/utils';
import type { PageNode } from '@/hooks/api';

/** Search uses the same folding for the query, titles and page addresses. */
export function normalizePageSearch(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}|ـ/gu, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه');
}

/** Original-string offsets keep highlighted Arabic and accented text intact. */
export function pageMatchRanges(text: string, query: string): Array<[number, number]> {
  const needle = normalizePageSearch(query.trim());
  if (!needle) return [];
  let folded = '';
  const offsets: Array<[number, number]> = [];
  let offset = 0;
  for (const char of text) {
    const normalized = normalizePageSearch(char);
    folded += normalized;
    for (let unit = 0; unit < normalized.length; unit++) {
      offsets.push([offset, offset + char.length]);
    }
    const previous = offsets[offsets.length - 1];
    if (!normalized && previous) previous[1] = offset + char.length;
    offset += char.length;
  }
  const ranges: Array<[number, number]> = [];
  for (let index = folded.indexOf(needle); index !== -1; index = folded.indexOf(needle, index + needle.length)) {
    const start = offsets[index];
    const end = offsets[index + needle.length - 1];
    if (start && end) ranges.push([start[0], end[1]]);
  }
  return ranges;
}

/** Include matching pages and their ancestor chain, even inside folded groups. */
export function filterPageIds(pages: readonly PageNode[], query: string): Set<string> {
  const needle = normalizePageSearch(query.trim());
  const byId = new Map(pages.map((page) => [page.id, page]));
  const included = new Set<string>();
  for (const page of pages) {
    if (needle && ![page.title, page.config?.sidebarTitle ?? '', page.path, page.slug].some((value) => normalizePageSearch(value).includes(needle)))
      continue;
    let current: PageNode | undefined = page;
    while (current && !included.has(current.id)) {
      included.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return included;
}

/** `id` plus every page below it (children, grandchildren, …). */
export function subtreeIds(pages: ReadonlyArray<Pick<PageNode, 'id' | 'parentId'>>, id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const page of pages) {
    if (!page.parentId) continue;
    const list = children.get(page.parentId) ?? [];
    list.push(page.id);
    children.set(page.parentId, list);
  }
  const seen = new Set<string>([id]);
  const queue = [...(children.get(id) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(children.get(next) ?? []));
  }
  return seen;
}

/** How many pages sit below `id`. Deleting a page deletes this whole subtree,
 *  so the confirmation must say so. */
export function countDescendants(pages: ReadonlyArray<Pick<PageNode, 'id' | 'parentId'>>, id: string): number {
  return subtreeIds(pages, id).size - 1;
}

/**
 * A placeholder text in the PAGE's language (an Arabic page starts as
 * "صفحة بدون عنوان", even when the dashboard is in English). Falls back to
 * the interface language when the page language has no interface catalog.
 */
export function messageInLanguage(key: MessageKey, languageCode: string | undefined, fallback: (key: MessageKey) => string): string {
  const locale = resolveLocale(languageCode);
  return locale ? translateFn(key, undefined, locale) : fallback(key);
}

const PLACEHOLDER_SLUG_RE = /^(?:untitled|new-group)(?:-\d+)?$/;

/**
 * While a page has never been published, its web address follows its title, so
 * an accidental first title ("UntitledGetting started") doesn't get baked into
 * the URL. It stops following as soon as the address no longer matches the
 * title (the writer edited it in page settings) or the page is published.
 *
 * Returns the value to send as `slug` with the title change, or undefined to
 * leave the address alone. The server slugifies it (Unicode-aware) and keeps it
 * unique among siblings.
 */
export function titleSlugToFollow({
  slug,
  serverTitle,
  nextTitle,
  unpublished,
}: {
  /** The page's current address segment on the server. */
  slug: string;
  /** The title the server has for the page right now. */
  serverTitle: string;
  /** The title about to be saved. */
  nextTitle: string;
  /** True only when we know the page has never been published. */
  unpublished: boolean;
}): string | undefined {
  const title = nextTitle.trim();
  if (!unpublished || !title || title === serverTitle.trim() || !slugifyUnicode(title)) return undefined;
  if (PLACEHOLDER_SLUG_RE.test(slug)) return title;
  const base = slugifyUnicode(serverTitle) || 'page';
  // `uniqueSiblingSlug` may have appended "-2", "-3"… to the derived address.
  return slug === base || new RegExp(`^${escapeRegExp(base)}-\\d+$`).test(slug) ? title : undefined;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where a page switch is heading: a page being created, or an existing node. */
export type PendingSwitch = { kind: 'create' } | { kind: 'open'; id: string };

/**
 * A switch is settled once the target node is selected AND its content is on
 * screen (a group needs no content). Until then the canvas stays locked, so
 * keystrokes can never land in the page that is being left.
 */
export function isSwitchSettled(
  pending: PendingSwitch | null,
  shown: { selectedId: string | null; groupId: string | null; pageId: string | null },
): boolean {
  if (!pending) return true;
  if (pending.kind === 'create') return false;
  return shown.selectedId === pending.id && (shown.groupId === pending.id || shown.pageId === pending.id);
}

/**
 * The structure revision the server reports for this branch's page list
 * (`x-page-structure-revision`), from the rows the tree shows, so a move can be
 * refused if the tree changed since the writer chose its destination.
 * Undefined when it can't be computed exactly: rows without their branch, or
 * no Web Crypto (an insecure origin). The move then goes without it.
 */
export async function pageStructureRevision(rows: readonly PageNode[]): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || rows.some((page) => !page.branchId)) return undefined;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(pageStructureRevisionSource(rows)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
