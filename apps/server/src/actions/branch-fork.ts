import type { PageKind, Prisma } from '@nibleaf/database';

/**
 * Fork tracking for versions (non-default branches).
 *
 * When a version is copied from main we record `forkedAt` and a baseline of
 * main's pages at that moment (see {@link ForkBaseline}). "Promote into main"
 * compares main against the baseline to list what changed on main since the
 * fork, and keeps what it must not discard.
 *
 * Promote rules (with a baseline):
 *  - A main page in the baseline is replaced by the version's copy, or removed
 *    when the version deleted its copy. That includes pages modified on main
 *    since the fork; the 409 confirmation exists so the writer sees them first.
 *  - A main page not in the baseline was added on main after the fork. It is
 *    kept. If its parent is replaced, it moves under the version's copy of that
 *    parent; if the version deleted the parent, it moves up to the nearest kept
 *    ancestor (or the top level).
 *  - A page deleted on main since the fork stays deleted, unless the version
 *    edited its copy (its `updatedAt` moved off the fork time). An unedited
 *    copy is still kept when it is the parent (or ancestor) of a kept version
 *    page, so the tree never loses a page's parent.
 *  - Pages created in the version are moved onto main.
 *
 * Versions created before fork tracking (no baseline) use `createdAt` as the
 * fork time: main pages created after it are "added" and kept, pages updated
 * after it are "modified", and deletions on main cannot be detected
 * (`baselineComplete: false`); the version's pages all move onto main.
 */

type ForkBaselineEntry = {
  /** The version's copy of this main page. */
  copyId: string;
  /** Main page's `updatedAt` at the fork (ISO). */
  updatedAt: string;
  title: string;
  path: string;
  languageId: string;
  kind: PageKind;
};

/** Main's pages at the fork, keyed by main page id. */
type ForkBaseline = { version: 1; pages: Record<string, ForkBaselineEntry> };

export type ForkPoint = { forkedAt: Date; baseline: ForkBaseline | null };

const entryOf = (baseline: ForkBaseline, mainPageId: string) => (Object.hasOwn(baseline.pages, mainPageId) ? baseline.pages[mainPageId] : undefined);

export type MainPageRow = {
  id: string;
  parentId: string | null;
  kind: PageKind;
  title: string;
  path: string;
  languageId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type VersionPageRow = { id: string; parentId: string | null; languageId: string; path: string; updatedAt: Date };

type ChangedOnMainPage = {
  /** Main page id. For a deleted page, the id it had on main. */
  pageId: string;
  title: string;
  path: string;
  languageCode: string;
  change: 'modified' | 'added' | 'deleted';
  /** When main last changed the page. For a deleted page, its last known
   *  `updatedAt` before the fork (the deletion time is not recorded). */
  updatedAt: string;
};

export type MergePreview = { changedOnMainSinceFork: ChangedOnMainPage[]; baselineComplete: boolean };

export const buildForkBaseline = (
  mainPages: Array<Pick<MainPageRow, 'id' | 'kind' | 'title' | 'path' | 'languageId' | 'updatedAt'>>,
  copyIdOf: (mainPageId: string) => string,
): Prisma.InputJsonObject => {
  const pages: Record<string, ForkBaselineEntry> = {};
  for (const p of mainPages) {
    pages[p.id] = {
      copyId: copyIdOf(p.id),
      updatedAt: p.updatedAt.toISOString(),
      title: p.title,
      path: p.path,
      languageId: p.languageId,
      kind: p.kind,
    };
  }
  return { version: 1, pages } satisfies ForkBaseline;
};

const isEntry = (value: unknown): value is ForkBaselineEntry => {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.copyId === 'string' &&
    typeof e.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(e.updatedAt)) &&
    typeof e.title === 'string' &&
    typeof e.path === 'string' &&
    typeof e.languageId === 'string' &&
    (e.kind === 'PAGE' || e.kind === 'GROUP')
  );
};

/** Read a stored baseline. Anything unexpected is treated as "no baseline"
 *  (the legacy, createdAt-based comparison) rather than trusted. */
const parseForkBaseline = (value: Prisma.JsonValue | null): ForkBaseline | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { version, pages } = value as Record<string, unknown>;
  if (version !== 1 || !pages || typeof pages !== 'object' || Array.isArray(pages)) return null;
  return Object.values(pages).every(isEntry) ? (value as ForkBaseline) : null;
};

export const forkPointOf = (branch: { createdAt: Date; forkedAt: Date | null; forkBaseline: Prisma.JsonValue | null }): ForkPoint => {
  const baseline = branch.forkedAt ? parseForkBaseline(branch.forkBaseline) : null;
  return { forkedAt: branch.forkedAt ?? branch.createdAt, baseline };
};

const byPath = (a: ChangedOnMainPage, b: ChangedOnMainPage) =>
  a.path.localeCompare(b.path, 'en') || a.languageCode.localeCompare(b.languageCode, 'en') || a.pageId.localeCompare(b.pageId, 'en');

/** Pages on main that changed since the fork, sorted by path. A group (folder)
 *  counts as modified only when its title or path changed; reordering or other
 *  bookkeeping on a group is not a change worth confirming. */
export const diffMainSinceFork = (mainPages: MainPageRow[], fork: ForkPoint, languageCodes: Map<string, string>): MergePreview => {
  const changed: ChangedOnMainPage[] = [];
  const code = (languageId: string) => languageCodes.get(languageId) ?? '';
  const row = (p: { title: string; path: string; languageId: string }, pageId: string, change: ChangedOnMainPage['change'], updatedAt: string) =>
    changed.push({ pageId, title: p.title, path: p.path, languageCode: code(p.languageId), change, updatedAt });

  const { baseline, forkedAt } = fork;
  if (baseline) {
    const onMain = new Set(mainPages.map((p) => p.id));
    for (const p of mainPages) {
      const before = entryOf(baseline, p.id);
      if (!before) {
        row(p, p.id, 'added', p.updatedAt.toISOString());
        continue;
      }
      if (p.updatedAt.getTime() === Date.parse(before.updatedAt)) continue;
      if (p.kind === 'GROUP' && p.title === before.title && p.path === before.path) continue;
      row(p, p.id, 'modified', p.updatedAt.toISOString());
    }
    for (const [id, before] of Object.entries(baseline.pages)) {
      if (!onMain.has(id)) row(before, id, 'deleted', before.updatedAt);
    }
  } else {
    // Legacy version: no record of main's titles at the fork, so any later
    // update to a group is listed (over-reporting beats a silent overwrite).
    const fork = forkedAt.getTime();
    for (const p of mainPages) {
      if (p.createdAt.getTime() > fork) row(p, p.id, 'added', p.updatedAt.toISOString());
      else if (p.updatedAt.getTime() > fork) row(p, p.id, 'modified', p.updatedAt.toISOString());
    }
  }
  return { changedOnMainSinceFork: changed.sort(byPath), baselineComplete: baseline !== null };
};

export type PromotePlan = {
  /** Main pages replaced by (or removed with) the version. */
  deleteMainIds: string[];
  /** Version copies of pages deleted on main that the version never edited. */
  dropVersionIds: string[];
  /** Kept main pages whose parent is going away, with their new parent. */
  reparent: Array<{ id: string; parentId: string | null }>;
};

/** Decide what a promote keeps, replaces and drops. See the module comment. */
export const planPromote = (mainPages: MainPageRow[], versionPages: VersionPageRow[], fork: ForkPoint): PromotePlan => {
  const { baseline, forkedAt } = fork;
  const versionById = new Map(versionPages.map((p) => [p.id, p]));
  const mainById = new Map(mainPages.map((p) => [p.id, p]));
  const replaced = (p: MainPageRow) => (baseline ? entryOf(baseline, p.id) !== undefined : p.createdAt.getTime() <= forkedAt.getTime());
  const deleteMain = new Set(mainPages.filter(replaced).map((p) => p.id));

  // Version copies whose main page is gone and that the version left untouched.
  const drop = new Set<string>();
  if (baseline) {
    for (const [mainId, before] of Object.entries(baseline.pages)) {
      const copy = versionById.get(before.copyId);
      if (!mainById.has(mainId) && copy && copy.updatedAt.getTime() === forkedAt.getTime()) drop.add(copy.id);
    }
    // Keep every ancestor of a kept version page so no page loses its parent.
    for (const p of versionPages) {
      if (drop.has(p.id)) continue;
      const seen = new Set<string>();
      for (let parent = p.parentId; parent && !seen.has(parent); parent = versionById.get(parent)?.parentId ?? null) {
        seen.add(parent);
        drop.delete(parent);
      }
    }
  }

  // Where a replaced main page lives on after the promote, if anywhere.
  const versionByLocation = new Map(versionPages.map((p) => [`${p.languageId}\u0000${p.path}`, p.id]));
  const successorOf = (mainId: string): string | null => {
    const main = mainById.get(mainId);
    const copyId = baseline ? entryOf(baseline, mainId)?.copyId : main && versionByLocation.get(`${main.languageId}\u0000${main.path}`);
    return copyId && versionById.has(copyId) && !drop.has(copyId) ? copyId : null;
  };
  const newParentOf = (parentId: string | null): string | null => {
    const seen = new Set<string>();
    let current = parentId;
    while (current && !seen.has(current)) {
      seen.add(current);
      if (!deleteMain.has(current)) return mainById.has(current) ? current : null;
      const successor = successorOf(current);
      if (successor) return successor;
      current = mainById.get(current)?.parentId ?? null;
    }
    return null;
  };

  const reparent: PromotePlan['reparent'] = [];
  for (const p of mainPages) {
    if (deleteMain.has(p.id) || !p.parentId || !deleteMain.has(p.parentId)) continue;
    reparent.push({ id: p.id, parentId: newParentOf(p.parentId) });
  }
  return { deleteMainIds: [...deleteMain], dropVersionIds: [...drop], reparent };
};
