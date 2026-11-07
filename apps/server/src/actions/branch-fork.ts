import { type PageKind, Prisma } from '@nibleaf/database';
import { joinPath } from '@nibleaf/shared/utils';

/**
 * Fork tracking for versions (non-default branches).
 *
 * When a version is copied from main we record `forkedAt` and a baseline of
 * main's pages at that moment (see {@link ForkBaseline}): for each main page,
 * the id of the version's copy, a hash of what the page says (see
 * {@link pageContentHash}), its parent and its position. "Promote into main"
 * compares both sides against it, three-way.
 *
 * Identity: promote updates main's pages IN PLACE from the version's copies and
 * then deletes the copies. Main page ids never change, so other open versions'
 * baselines stay valid across successive promotions, and comments and reader
 * grants on main pages survive. Comments on a consumed copy move to its main
 * page.
 *
 * A page "changed" on a side when its content hash or its parent differs from
 * the baseline. Position alone is not a change (dragging in the page tree
 * rewrites every sibling's position), but it is merged: a position the version
 * changed wins, otherwise main's stays.
 *
 * Promote rules (with a baseline), per main page at the fork:
 *  - On both sides: the parts the version changed (content, parent, position)
 *    replace main's; the parts it left alone keep main's current state. When
 *    both sides changed the content, the version wins: that is what the 409
 *    confirmation is for.
 *  - Deleted in the version: removed from main (listed when main also edited it).
 *  - Deleted on main: stays deleted, unless the version edited its copy. An
 *    unedited copy still comes back when a page the version keeps lives under
 *    it, so no page loses its parent.
 *  - Pages added on main since the fork are kept. If their parent goes away
 *    they move up to the nearest kept ancestor (or the top level), listed as
 *    `onPromote: 'moved'` with `newParentPath`.
 *  - Pages created in the version move onto main.
 *  - Same address: when two pages would end up at the same path in the same
 *    language, one keeps it and the others get a numbered slug ("refunds-2"),
 *    listed as `conflict`. A page whose address comes from main keeps it (main
 *    page first, then lowest id); a content-only edit does not move ownership.
 *    Clashes are settled top-down, so a renamed folder's pages follow it
 *    instead of being renamed again. Duplicates that were already on main and
 *    that the version did not touch are left as they are.
 *  - Cycles: if combining both sides' moves would put pages inside each other,
 *    promote is refused (409 `branch:promote_blocked`) and the pages are listed
 *    as `conflict` / `blocked`; confirming does not override it.
 *
 * A version forked from another version inherits that version's baseline, with
 * each copy id remapped onto its own copies, so it promotes with the same rules
 * and the first version's edits count as its own.
 *
 * Versions without a baseline (created before fork tracking, or forked from
 * such a version) use their fork time instead: main pages created after it are
 * "added" and kept, pages updated after it are "modified" and replaced, and
 * deletions on main cannot be detected (`baselineComplete: false`). All of the
 * version's pages move onto main.
 */

/** What a page says, as one hash: everything a reader or the page settings
 *  see, except its place in the tree (parent and position are compared
 *  separately, against logical ids). The same SQL hashes main pages and their
 *  copies, at the fork and at promote time. */
export const pageContentHash = () =>
  Prisma.sql`md5(json_build_array("kind", "title", "slug", "icon", "description", "content", "config", "translationKey", "hidden")::text)`;

type ForkBaselineEntry = {
  /** The version's copy of this main page. */
  copyId: string;
  /** Content hash of the main page at the fork. */
  hash: string;
  /** Content hash of the copy right after it was made (equal unless copying
   *  normalized a value). */
  copyHash: string;
  /** Main parent id at the fork. */
  parentId: string | null;
  position: number;
  /** Main page's `updatedAt` at the fork (ISO). */
  updatedAt: string;
  title: string;
  path: string;
  languageId: string;
  kind: PageKind;
};

/** Main's pages at the fork, keyed by main page id. */
type ForkBaseline = { version: 2; pages: Record<string, ForkBaselineEntry> };

export type ForkPoint = { forkedAt: Date; baseline: ForkBaseline | null };

const entryOf = (baseline: ForkBaseline, mainPageId: string) => (Object.hasOwn(baseline.pages, mainPageId) ? baseline.pages[mainPageId] : undefined);

/** One page row as promote reads it (both branches, one locked query). */
export type PromotePageRow = {
  id: string;
  parentId: string | null;
  kind: PageKind;
  title: string;
  slug: string;
  path: string;
  languageId: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  hash: string;
};

type OnPromote = 'kept' | 'replaced' | 'removed' | 'restored' | 'renamed' | 'moved' | 'blocked';

type ChangedOnMainPage = {
  /** Main page id (for a deleted page, the id it had). For `conflict`, the
   *  page being renamed or blocked, which may be a version page. */
  pageId: string;
  title: string;
  path: string;
  languageCode: string;
  change: 'modified' | 'added' | 'deleted' | 'conflict';
  /** What promote will do with it. */
  onPromote: OnPromote;
  /** `renamed` only: the page's new address. */
  newPath?: string;
  /** `moved` only: the address of its new parent (null: the top level). */
  newParentPath?: string | null;
  /** When main last changed the page. For a deleted page, its last known
   *  `updatedAt` before the fork (the deletion time is not recorded). */
  updatedAt: string;
};

export type MergePreview = { changedOnMainSinceFork: ChangedOnMainPage[]; baselineComplete: boolean };

/** Writes, all keyed to rows promote has locked and read. */
export type PromotePlan = {
  /** Main pages updated in place. `fromCopyId`: copy the content fields from
   *  that version copy. */
  mainUpdates: Array<{ id: string; fromCopyId?: string; data: { parentId?: string | null; position?: number; slug?: string } }>;
  /** Version pages that become main pages (keeping their ids). */
  moves: Array<{ id: string; data: { parentId: string | null; slug?: string } }>;
  /** Version copies folded into a main page: comments move, then the copy goes. */
  consumed: Array<{ copyId: string; mainId: string }>;
  /** Untouched copies of pages deleted on main. */
  dropVersionIds: string[];
  /** Main pages the version deleted (or, without a baseline, replaced). */
  deleteMainIds: string[];
  /** Combining both sides would create a parent cycle: promote must refuse. */
  blocked: boolean;
};

export const buildForkBaseline = (
  mainPages: Array<{
    id: string;
    parentId: string | null;
    kind: PageKind;
    title: string;
    path: string;
    languageId: string;
    position: number;
    updatedAt: Date;
  }>,
  copyIdOf: (mainPageId: string) => string,
  hashOf: (pageId: string) => string,
): Prisma.InputJsonObject => {
  const pages: Record<string, ForkBaselineEntry> = {};
  for (const p of mainPages) {
    const copyId = copyIdOf(p.id);
    pages[p.id] = {
      copyId,
      hash: hashOf(p.id),
      copyHash: hashOf(copyId),
      parentId: p.parentId,
      position: p.position,
      updatedAt: p.updatedAt.toISOString(),
      title: p.title,
      path: p.path,
      languageId: p.languageId,
      kind: p.kind,
    };
  }
  return { version: 2, pages } satisfies ForkBaseline;
};

const isEntry = (value: unknown): value is ForkBaselineEntry => {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.copyId === 'string' &&
    typeof e.hash === 'string' &&
    typeof e.copyHash === 'string' &&
    (e.parentId === null || typeof e.parentId === 'string') &&
    typeof e.position === 'number' &&
    typeof e.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(e.updatedAt)) &&
    typeof e.title === 'string' &&
    typeof e.path === 'string' &&
    typeof e.languageId === 'string' &&
    (e.kind === 'PAGE' || e.kind === 'GROUP')
  );
};

/** Read a stored baseline. Anything unexpected (including the unreleased v1
 *  shape) is treated as "no baseline" rather than trusted. */
const parseForkBaseline = (value: Prisma.JsonValue | null): ForkBaseline | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { version, pages } = value as Record<string, unknown>;
  if (version !== 2 || !pages || typeof pages !== 'object' || Array.isArray(pages)) return null;
  return Object.values(pages).every(isEntry) ? (value as ForkBaseline) : null;
};

/** The baseline for a version forked from `source` (another version): the same
 *  main pages and fork-time hashes, with each copy id remapped onto the new
 *  version's copies. An entry whose copy the source deleted keeps a copy id
 *  that no longer exists, so it reads as "deleted in the version" (and is
 *  removed from main on promote) rather than as "added on main". */
export const inheritForkBaseline = (source: ForkBaseline, copyIdOf: (sourcePageId: string) => string | undefined): Prisma.InputJsonObject => {
  const pages: Record<string, ForkBaselineEntry> = {};
  for (const [mainId, e] of Object.entries(source.pages)) pages[mainId] = { ...e, copyId: copyIdOf(e.copyId) ?? e.copyId };
  return { version: 2, pages } satisfies ForkBaseline;
};

export const forkPointOf = (branch: { createdAt: Date; forkedAt: Date | null; forkBaseline: Prisma.JsonValue | null }): ForkPoint => {
  const baseline = branch.forkedAt ? parseForkBaseline(branch.forkBaseline) : null;
  return { forkedAt: branch.forkedAt ?? branch.createdAt, baseline };
};

const byPath = (a: ChangedOnMainPage, b: ChangedOnMainPage) =>
  a.path.localeCompare(b.path, 'en') ||
  a.languageCode.localeCompare(b.languageCode, 'en') ||
  a.change.localeCompare(b.change, 'en') ||
  a.pageId.localeCompare(b.pageId, 'en');

const KEY = '\u0000';

/** Compare main and the version with the fork point: what changed on main (the
 *  preview, sorted by path) and what promote will write (the plan). */
export const analyzePromote = (
  mainPages: PromotePageRow[],
  versionPages: PromotePageRow[],
  fork: ForkPoint,
  languageCodes: Map<string, string>,
): { preview: MergePreview; plan: PromotePlan } => {
  const { baseline, forkedAt } = fork;
  const changed: ChangedOnMainPage[] = [];
  const code = (languageId: string) => languageCodes.get(languageId) ?? '';
  const list = (
    p: { title: string; path: string; languageId: string },
    pageId: string,
    change: ChangedOnMainPage['change'],
    onPromote: OnPromote,
    updatedAt: string,
  ) => changed.push({ pageId, title: p.title, path: p.path, languageCode: code(p.languageId), change, onPromote, updatedAt });

  const mainById = new Map(mainPages.map((p) => [p.id, p]));
  const versionById = new Map(versionPages.map((p) => [p.id, p]));
  const plan: PromotePlan = { mainUpdates: [], moves: [], consumed: [], dropVersionIds: [], deleteMainIds: [], blocked: false };
  const deleteMain = new Set<string>();
  /** Version page id → the main id it is folded into. */
  const foldedInto = new Map<string, string>();
  const moved = new Set<string>();
  /** Main id → partial update; version id → move data. */
  const mainData = new Map<string, { fromCopyId?: string; data: { parentId?: string | null; position?: number; slug?: string } }>();
  /** Version pages whose version parent decides their final parent. */
  const usesVersionParent = new Set<string>();

  if (baseline) {
    const copyToMain = new Map(Object.entries(baseline.pages).map(([mainId, e]) => [e.copyId, mainId]));
    const logicalParent = (copy: PromotePageRow) => (copy.parentId ? (copyToMain.get(copy.parentId) ?? copy.parentId) : null);
    const restoreCandidates = new Map<string, string>(); // copy id → main id (deleted on main, copy untouched)

    for (const [mainId, e] of Object.entries(baseline.pages)) {
      const m = mainById.get(mainId);
      const copy = versionById.get(e.copyId);
      const versionContent = copy ? copy.hash !== e.copyHash : false;
      const versionParent = copy ? logicalParent(copy) !== e.parentId : false;
      const versionEdited = versionContent || versionParent;
      if (m) {
        const mainEdited = m.hash !== e.hash || m.parentId !== e.parentId;
        if (!copy) {
          deleteMain.add(mainId);
          if (mainEdited) list(m, mainId, 'modified', 'removed', m.updatedAt.toISOString());
          continue;
        }
        if (mainEdited) list(m, mainId, 'modified', versionEdited ? 'replaced' : 'kept', m.updatedAt.toISOString());
        foldedInto.set(copy.id, mainId);
        plan.consumed.push({ copyId: copy.id, mainId });
        const update: { fromCopyId?: string; data: { parentId?: string | null; position?: number } } = { data: {} };
        if (versionContent) update.fromCopyId = copy.id;
        if (versionParent) usesVersionParent.add(copy.id);
        if (copy.position !== e.position) update.data.position = copy.position;
        mainData.set(mainId, update);
      } else if (copy && versionEdited) {
        moved.add(copy.id);
        usesVersionParent.add(copy.id);
      } else if (copy) {
        restoreCandidates.set(copy.id, mainId);
      } else {
        list(e, mainId, 'deleted', 'removed', e.updatedAt);
      }
    }
    for (const p of versionPages) {
      if (!copyToMain.has(p.id)) {
        moved.add(p.id);
        usesVersionParent.add(p.id);
      }
    }
    // A page the version keeps must keep its parent: bring back untouched
    // copies it lives under.
    const queue = [...usesVersionParent];
    while (queue.length > 0) {
      const id = queue.pop() as string;
      const parent = versionById.get(id)?.parentId;
      if (parent && restoreCandidates.has(parent)) {
        restoreCandidates.delete(parent);
        moved.add(parent);
        usesVersionParent.add(parent);
        queue.push(parent);
      }
    }
    for (const [mainId, e] of Object.entries(baseline.pages)) {
      if (mainById.has(mainId) || !versionById.has(e.copyId)) continue;
      list(e, mainId, 'deleted', moved.has(e.copyId) ? 'restored' : 'removed', e.updatedAt);
    }
    plan.dropVersionIds = [...restoreCandidates.keys()];
    for (const p of mainPages) {
      if (!entryOf(baseline, p.id)) list(p, p.id, 'added', 'kept', p.updatedAt.toISOString());
    }
  } else {
    // No baseline: main pages that existed at the fork are replaced by the
    // version's pages; pages created on main after it are kept.
    const fork = forkedAt.getTime();
    for (const p of mainPages) {
      if (p.createdAt.getTime() > fork) {
        list(p, p.id, 'added', 'kept', p.updatedAt.toISOString());
      } else {
        deleteMain.add(p.id);
        if (p.updatedAt.getTime() > fork) list(p, p.id, 'modified', 'replaced', p.updatedAt.toISOString());
      }
    }
    for (const p of versionPages) {
      moved.add(p.id);
      usesVersionParent.add(p.id);
    }
  }

  // Final parents. A version parent maps to the main page it is folded into.
  const resolveVersionParent = (parentId: string | null) => (parentId ? (foldedInto.get(parentId) ?? parentId) : null);
  const versionLocation = new Map(versionPages.map((p) => [`${p.languageId}${KEY}${p.path}`, p.id]));
  const finalParent = new Map<string, string | null>();
  for (const id of moved) finalParent.set(id, resolveVersionParent(versionById.get(id)?.parentId ?? null));
  for (const p of mainPages) {
    if (!deleteMain.has(p.id)) finalParent.set(p.id, p.parentId);
  }
  const versionPlaced = new Set<string>();
  for (const [copyId, mainId] of foldedInto) {
    if (usesVersionParent.has(copyId)) {
      versionPlaced.add(mainId);
      const parent = resolveVersionParent(versionById.get(copyId)?.parentId ?? null);
      finalParent.set(mainId, parent);
      const update = mainData.get(mainId);
      if (update) update.data.parentId = parent;
    }
  }
  // A main page whose parent is deleted moves up to the nearest kept ancestor.
  // Without a baseline, prefer the version's page at the parent's old address.
  const survives = (id: string) => finalParent.has(id);
  const nearestKept = (parentId: string | null): string | null => {
    const seen = new Set<string>();
    let current = parentId;
    while (current && !seen.has(current)) {
      seen.add(current);
      if (survives(current)) return current;
      const old = mainById.get(current);
      if (!baseline && old) {
        const successor = versionLocation.get(`${old.languageId}${KEY}${old.path}`);
        if (successor && survives(successor)) return successor;
      }
      current = old?.parentId ?? null;
    }
    return null;
  };
  /** Main pages that keep main's place but lose their parent. */
  const rehomed = new Set<string>();
  for (const [id, parent] of finalParent) {
    if (parent && !survives(parent)) {
      const next = nearestKept(parent);
      finalParent.set(id, next);
      if (mainById.has(id) && !moved.has(id)) {
        rehomed.add(id);
        const update = mainData.get(id) ?? { data: {} };
        update.data.parentId = next;
        mainData.set(id, update);
      }
    }
  }

  const titleOf = (id: string) => {
    const source = mainData.get(id)?.fromCopyId;
    return (source ? versionById.get(source)?.title : undefined) ?? mainById.get(id)?.title ?? versionById.get(id)?.title ?? '';
  };
  const rowOf = (id: string) => (moved.has(id) ? versionById.get(id) : (mainById.get(id) ?? versionById.get(id)));

  // Cycles: both sides' moves combined must still form a tree.
  const state = new Map<string, 'walking' | 'done'>();
  const inCycle = new Set<string>();
  for (const start of [...finalParent.keys()].sort()) {
    const path: string[] = [];
    let current: string | null = start;
    while (current && finalParent.has(current) && !state.has(current)) {
      state.set(current, 'walking');
      path.push(current);
      current = finalParent.get(current) ?? null;
    }
    if (current && state.get(current) === 'walking') {
      for (const id of path.slice(path.indexOf(current))) inCycle.add(id);
    }
    for (const id of path) state.set(id, 'done');
  }
  if (inCycle.size > 0) {
    plan.blocked = true;
    for (const id of [...inCycle].sort()) {
      const r = rowOf(id);
      changed.push({
        pageId: id,
        title: titleOf(id),
        path: r?.path ?? '',
        languageCode: code(r?.languageId ?? ''),
        change: 'conflict',
        onPromote: 'blocked',
        updatedAt: (r?.updatedAt ?? new Date(0)).toISOString(),
      });
    }
  }

  // Addresses on the final tree, settled top-down so a renamed folder's pages
  // follow it.
  const copySlug = (id: string) => {
    const source = mainData.get(id)?.fromCopyId;
    return source ? versionById.get(source)?.slug : undefined;
  };
  const slugOf = (id: string) => copySlug(id) ?? rowOf(id)?.slug ?? '';
  const languageOf = (id: string) => rowOf(id)?.languageId ?? '';
  /** The page's address comes from the version: it moved in, the version
   *  placed it, or the version renamed it. A content-only edit does not count. */
  const addressFromVersion = (id: string) => {
    if (moved.has(id) || versionPlaced.has(id)) return true;
    const slug = copySlug(id);
    return slug !== undefined && slug !== mainById.get(id)?.slug;
  };
  const renamedSlug = new Map<string, string>();
  const finalPath = new Map<string, string>();
  const parentPathOf = (id: string): string | null => {
    const parent = finalParent.get(id) ?? null;
    return parent ? (finalPath.get(parent) ?? null) : null;
  };
  const newParentPath = new Map<string, string | null>();
  if (!plan.blocked) {
    const depth = new Map<string, number>();
    const depthOf = (id: string): number => {
      const known = depth.get(id);
      if (known !== undefined) return known;
      const parent = finalParent.get(id) ?? null;
      const d = parent && finalParent.has(parent) ? depthOf(parent) + 1 : 0;
      depth.set(id, d);
      return d;
    };
    const levels = new Map<number, string[]>();
    for (const id of finalParent.keys()) levels.set(depthOf(id), [...(levels.get(depthOf(id)) ?? []), id]);
    for (const level of [...levels.keys()].sort((a, b) => a - b)) {
      const ids = (levels.get(level) ?? []).sort();
      const groups = new Map<string, string[]>();
      for (const id of ids) {
        const path = joinPath(parentPathOf(id), slugOf(id));
        finalPath.set(id, path);
        const key = `${languageOf(id)}${KEY}${path}`;
        groups.set(key, [...(groups.get(key) ?? []), id]);
      }
      const taken = new Set(groups.keys());
      for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
        if (group.length < 2 || !group.some(addressFromVersion)) continue;
        const [, ...others] = [...group].sort(
          (a, b) =>
            Number(addressFromVersion(a)) - Number(addressFromVersion(b)) ||
            Number(!mainById.has(a) || moved.has(a)) - Number(!mainById.has(b) || moved.has(b)) ||
            a.localeCompare(b, 'en'),
        );
        for (const id of others) {
          // Duplicates already on main that the version did not touch stay.
          if (!addressFromVersion(id)) continue;
          const slug = slugOf(id);
          const parentPath = parentPathOf(id);
          let n = 2;
          let candidate = `${slug}-${n}`;
          while (taken.has(`${languageOf(id)}${KEY}${joinPath(parentPath, candidate)}`)) candidate = `${slug}-${++n}`;
          const newPath = joinPath(parentPath, candidate);
          taken.add(`${languageOf(id)}${KEY}${newPath}`);
          renamedSlug.set(id, candidate);
          finalPath.set(id, newPath);
          changed.push({
            pageId: id,
            title: titleOf(id),
            path: key.slice(key.indexOf(KEY) + 1),
            languageCode: code(languageOf(id)),
            change: 'conflict',
            onPromote: 'renamed',
            newPath,
            updatedAt: (rowOf(id)?.updatedAt ?? new Date(0)).toISOString(),
          });
        }
      }
    }
    // Pages main keeps but whose parent goes away: say where they land.
    for (const id of rehomed) newParentPath.set(id, parentPathOf(id));
  }
  for (const [id, parentPath] of newParentPath) {
    const entry = changed.find((c) => c.pageId === id && (c.change === 'added' || c.change === 'modified'));
    if (entry) {
      if (entry.onPromote === 'kept') entry.onPromote = 'moved';
      entry.newParentPath = parentPath;
    } else {
      const r = mainById.get(id);
      if (r) list(r, id, 'modified', 'moved', r.updatedAt.toISOString());
      const added = changed.at(-1);
      if (added) added.newParentPath = parentPath;
    }
  }

  for (const [id, update] of mainData) {
    const slug = renamedSlug.get(id);
    const data = { ...update.data, ...(slug ? { slug } : {}) };
    if (update.fromCopyId === undefined && Object.keys(data).length === 0) continue;
    plan.mainUpdates.push({ id, ...(update.fromCopyId ? { fromCopyId: update.fromCopyId } : {}), data });
  }
  for (const id of [...moved].sort()) {
    const slug = renamedSlug.get(id);
    plan.moves.push({ id, data: { parentId: finalParent.get(id) ?? null, ...(slug ? { slug } : {}) } });
  }
  plan.deleteMainIds = [...deleteMain];
  return { preview: { changedOnMainSinceFork: changed.sort(byPath), baselineComplete: baseline !== null }, plan };
};
