import { type MessageKey, resolveLocale, translateFn } from '@nibleaf/i18n';
import { slugifyUnicode } from '@nibleaf/shared/utils';
import type { PageNode } from '@/hooks/api';

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
