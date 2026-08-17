import type { SnapshotPage } from '@nibleaf/shared/site';

/** Filter a deployment snapshot to page grants while retaining only ancestor
 * groups required to render a coherent navigation path. */
export const filterPagesForReader = (pages: SnapshotPage[], allowedPageIds: Set<string> | null): SnapshotPage[] => {
  if (!allowedPageIds) return pages;
  const byId = new Map(pages.map((page) => [page.id, page]));
  const visible = new Set(allowedPageIds);
  for (const id of allowedPageIds) {
    let current = byId.get(id);
    while (current?.parentId) {
      visible.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }
  return pages.filter((page) => visible.has(page.id));
};
