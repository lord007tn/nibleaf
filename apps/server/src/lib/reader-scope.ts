import { navigationOnly } from '@nibleaf/shared/asset-references';
import type { SnapshotPage } from '@nibleaf/shared/site';

/** Filter a deployment snapshot to a reader's page grants. Page bodies require
 *  an explicit grant: each granted page is kept as published, while ungranted
 *  ancestors are kept only as navigation labels so the tree stays coherent. */
export const filterPagesForReader = (pages: SnapshotPage[], allowedPageIds: Set<string> | null): SnapshotPage[] => {
  if (!allowedPageIds) return pages;
  const byId = new Map(pages.map((page) => [page.id, page]));
  const ancestors = new Set<string>();
  for (const id of allowedPageIds) {
    let current = byId.get(id);
    while (current?.parentId && !ancestors.has(current.parentId)) {
      ancestors.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }
  return pages.flatMap((page) => {
    if (allowedPageIds.has(page.id)) return [page];
    return ancestors.has(page.id) ? [navigationOnly(page)] : [];
  });
};
