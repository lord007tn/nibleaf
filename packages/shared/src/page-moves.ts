/** An intent resolved against the current sibling order, never a tree snapshot. */
export interface PageMoveIntent {
  pageId: string;
  parentId: string | null;
  position: { before: string } | { after: string } | { at: 'start' | 'end' };
  languageId?: string;
  expectedStructureRevision?: string;
}

export interface PageStructureRow {
  id: string;
  parentId: string | null;
  position: number;
  languageId: string;
  branchId?: string;
}

export type PageStructureChange = Pick<PageStructureRow, 'id' | 'parentId' | 'position' | 'languageId'>;

/** The server validates tenant, parent and cycle invariants under its lock.
 * A missing/moved anchor cannot silently become a different destination.
 * Clients with an incomplete cache skip optimism when this returns null. */
export function resolvePageMove(rows: readonly PageStructureRow[], intent: PageMoveIntent): PageStructureChange[] | null {
  const moving = rows.find((page) => page.id === intent.pageId);
  if (!moving) return null;
  const languageId = intent.languageId ?? moving.languageId;
  if (intent.parentId) {
    const parent = rows.find((page) => page.id === intent.parentId);
    if (!parent || parent.branchId !== moving.branchId || parent.languageId !== languageId) return null;
  }
  const siblings = (parentId: string | null, language: string) =>
    rows
      .filter((page) => page.id !== moving.id && page.branchId === moving.branchId && page.parentId === parentId && page.languageId === language)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const destination = siblings(intent.parentId, languageId);
  let index: number;
  if ('at' in intent.position) index = intent.position.at === 'start' ? 0 : destination.length;
  else {
    const anchor = 'before' in intent.position ? intent.position.before : intent.position.after;
    index = destination.findIndex((page) => page.id === anchor);
    if (index < 0) return null;
    if ('after' in intent.position) index += 1;
  }
  destination.splice(index, 0, { ...moving, parentId: intent.parentId, languageId });
  const changes = new Map<string, PageStructureChange>();
  const before = new Map(rows.map((page) => [page.id, page]));
  const put = (page: PageStructureRow, position: number) => {
    const old = before.get(page.id);
    if (old && (page.parentId !== old.parentId || page.languageId !== old.languageId || position !== old.position)) {
      changes.set(page.id, { id: page.id, parentId: page.parentId, languageId: page.languageId, position });
    }
  };
  destination.forEach(put);
  if (moving.parentId !== intent.parentId || moving.languageId !== languageId) siblings(moving.parentId, moving.languageId).forEach(put);
  if (moving.languageId !== languageId) {
    const children = new Map<string, PageStructureRow[]>();
    for (const page of rows)
      if (page.parentId) {
        const list = children.get(page.parentId) ?? [];
        list.push(page);
        children.set(page.parentId, list);
      }
    const seen = new Set([moving.id]);
    const stack = [...(children.get(moving.id) ?? [])];
    while (stack.length) {
      const page = stack.pop();
      if (!page || seen.has(page.id)) continue;
      seen.add(page.id);
      if (page.branchId !== moving.branchId) return null;
      put({ ...page, languageId }, page.position);
      stack.push(...(children.get(page.id) ?? []));
    }
  }
  return [...changes.values()];
}
