import type { PageNode } from './types';

export interface PageMove {
  id: string;
  parentId: string | null;
  position: number;
  /** Moves the page to another language of the site. */
  languageId?: string;
}

type CachedPage = Pick<PageNode, 'id' | 'parentId' | 'position'> & { languageId?: string; branchId?: string };

/** Apply a reorder request to a cached page list, so the tree shows the new
 *  order immediately instead of snapping back until the refetch lands. Pages
 *  that aren't part of the request are left untouched, except that a page
 *  moved to another language takes its cached descendants along, as the
 *  server does (even one created after the request was built). */
export function applyPageReorder<T extends CachedPage>(pages: T[], items: PageMove[]): T[] {
  const moves = new Map(items.map((item) => [item.id, item]));
  if (moves.size === 0) return pages;
  const next = pages.map((page) => {
    const move = moves.get(page.id);
    if (!move) return page;
    const language = move.languageId !== undefined && move.languageId !== page.languageId ? { languageId: move.languageId } : {};
    return move.parentId !== page.parentId || move.position !== page.position || 'languageId' in language
      ? { ...page, parentId: move.parentId, position: move.position, ...language }
      : page;
  });
  const children = new Map<string, number[]>();
  next.forEach((page, index) => {
    if (page.parentId) children.set(page.parentId, [...(children.get(page.parentId) ?? []), index]);
  });
  const stack = next.flatMap((page, index) => (page.languageId !== pages[index]?.languageId ? [page] : []));
  while (stack.length > 0) {
    const parent = stack.pop() as T;
    for (const index of children.get(parent.id) ?? []) {
      const child = next[index] as T;
      if (moves.get(child.id)?.languageId !== undefined || child.languageId === parent.languageId) continue;
      next[index] = { ...child, languageId: parent.languageId };
      stack.push(next[index] as T);
    }
  }
  // A list the move doesn't touch keeps its identity, so its subscribers don't re-render.
  return next.every((page, index) => page === pages[index]) ? pages : next;
}

/** Keep a language-filtered page list (`languageId` from its query key) true to
 *  its language after a move: pages that left are dropped, and pages that moved
 *  in are added from `known` (every cached page, already reordered). A list for
 *  every language (`languageId` null) only gets the reorder. Pages from another
 *  docs version are never added. */
export function applyPageReorderToList<T extends CachedPage>(
  pages: T[],
  items: PageMove[],
  scope: { languageId: string | null; branchId: string | null },
  known: ReadonlyMap<string, T>,
): T[] {
  const reordered = applyPageReorder(pages, items);
  if (!scope.languageId || items.every((item) => item.languageId === undefined)) return reordered;
  const branchId = scope.branchId ?? pages.find((page) => page.branchId)?.branchId ?? null;
  const kept = reordered.filter((page) => page.languageId === scope.languageId);
  const present = new Set(kept.map((page) => page.id));
  const arrived = [...known.values()].filter(
    (page) => page.languageId === scope.languageId && !present.has(page.id) && branchId !== null && page.branchId === branchId,
  );
  return kept.length === reordered.length && arrived.length === 0 ? reordered : [...kept, ...arrived];
}

/** Page-list queries are keyed `['pages', projectId, languageId, branchId]`;
 *  page details are `['pages', projectId, pageId]`. */
export const isPageListKey = (queryKey: readonly unknown[]) => queryKey.length === 4;

/** Undo only structural fields still owned by this optimistic write. A cache
 * edit to a title, or a later structural value, belongs to its newer writer. */
export function rollbackPageReorder<T extends CachedPage>(current: T[], before: T[], optimistic: T[]): T[] {
  const oldById = new Map(before.map((page) => [page.id, page]));
  const optimisticById = new Map(optimistic.map((page) => [page.id, page]));
  const next = current.flatMap((page) => {
    const old = oldById.get(page.id);
    const written = optimisticById.get(page.id);
    if (!written) return [page];
    if (!old) return page === written ? [] : [page];
    const restored = { ...page };
    for (const field of ['parentId', 'position', 'languageId'] as const) {
      if (old[field] !== written[field] && page[field] === written[field]) Object.assign(restored, { [field]: old[field] });
    }
    return [restored];
  });
  // Restore removed language-list members only while the list is still ours;
  // never resurrect a page a later cache write removed. Refetch settles gaps.
  if (current === optimistic) for (const page of before) if (!optimisticById.has(page.id)) next.push(page);
  return next;
}

/** A page revision's time, from the server's `updatedAt` (oldest when missing). */
const revisionTime = (page: { updatedAt?: string } | undefined): number => {
  const time = page?.updatedAt ? Date.parse(page.updatedAt) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

/** Whether `cached` holds a strictly newer revision of the page than `incoming`. */
export const isNewerRevision = (cached: { updatedAt?: string } | undefined, incoming: { updatedAt?: string }): boolean =>
  revisionTime(cached) > revisionTime(incoming);

/** The newer of two copies of one page: a response or fetch that resolves late
 *  never replaces a revision the cache already has. */
export const newerRevision = <T extends { updatedAt?: string }>(cached: T | undefined, incoming: T): T =>
  cached && isNewerRevision(cached, incoming) ? cached : incoming;

/** A fetched page list, keeping any row the cache already holds at a newer
 *  revision (a save response that landed while the list request was in flight). */
export function keepNewerPageRows<T extends { id: string; updatedAt?: string }>(cached: readonly T[] | undefined, incoming: T[]): T[] {
  if (!cached?.length) return incoming;
  const byId = new Map(cached.map((page) => [page.id, page]));
  let kept = false;
  const merged = incoming.map((row) => {
    const current = byId.get(row.id);
    if (current && isNewerRevision(current, row)) {
      kept = true;
      return current;
    }
    return row;
  });
  return kept ? merged : incoming;
}
