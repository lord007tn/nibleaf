import type { PageNode } from './types';

export interface PageMove {
  id: string;
  parentId: string | null;
  position: number;
  /** Moves the page to another language of the site. */
  languageId?: string;
}

/** Apply a reorder request to a cached page list, so the tree shows the new
 *  order immediately instead of snapping back until the refetch lands. Pages
 *  that aren't part of the request are left untouched. */
export function applyPageReorder<T extends Pick<PageNode, 'id' | 'parentId' | 'position'> & { languageId?: string }>(
  pages: T[],
  items: PageMove[],
): T[] {
  const moves = new Map(items.map((item) => [item.id, item]));
  if (moves.size === 0) return pages;
  return pages.map((page) => {
    const move = moves.get(page.id);
    if (!move) return page;
    const language = move.languageId !== undefined && move.languageId !== page.languageId ? { languageId: move.languageId } : {};
    return move.parentId !== page.parentId || move.position !== page.position || 'languageId' in language
      ? { ...page, parentId: move.parentId, position: move.position, ...language }
      : page;
  });
}

/** Page-list queries are keyed `['pages', projectId, languageId, branchId]`;
 *  page details are `['pages', projectId, pageId]`. */
export const isPageListKey = (queryKey: readonly unknown[]) => queryKey.length === 4;
