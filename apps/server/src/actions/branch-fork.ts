import { type PageKind, Prisma } from '@nibleaf/database';

/**
 * Fork tracking for versions (non-default branches).
 *
 * When a version is copied from main we record `forkedAt` and a baseline of
 * main's pages at that moment (see {@link ForkBaseline}): for each main page,
 * the id of the version's copy, a hash of what the page says (see
 * {@link pageContentHash}), its parent and its position. A version forked from
 * another version inherits that version's baseline, with each copy id remapped
 * onto its own copies.
 *
 * The recording, the hash and the stored shape are shared, unchanged, with the
 * in-place merge that will replace this refusal (#326), so baselines recorded
 * now stay readable then without a migration.
 *
 * For now "Promote into main" only asks whether main changed since the fork: a
 * main page counts as changed when its content hash or its parent differs from
 * the baseline (position alone is not a change: dragging in the page tree
 * rewrites every sibling's position), added when the baseline lacks it, and
 * deleted when the baseline has it and main does not. Any change refuses.
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

/** A page changed on main since the fork. A subset of #326's preview entry
 *  (which adds `onPromote`, `newPath`, `newParentPath` and `conflict`), so the
 *  editor keeps the same contract when that merge lands. */
type ChangedOnMainPage = {
  /** Main page id (for a deleted page, the id it had). */
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

/** Main pages modified, added or deleted since the fork, sorted by path. */
export const changedOnMainSinceFork = (
  mainPages: Array<Pick<PromotePageRow, 'id' | 'parentId' | 'title' | 'path' | 'languageId' | 'updatedAt' | 'hash'>>,
  baseline: ForkBaseline,
  languageCodes: Map<string, string>,
): ChangedOnMainPage[] => {
  const code = (languageId: string) => languageCodes.get(languageId) ?? '';
  const changed: ChangedOnMainPage[] = [];
  const onMain = new Set<string>();
  for (const m of mainPages) {
    onMain.add(m.id);
    const e = entryOf(baseline, m.id);
    if (e && m.hash === e.hash && m.parentId === e.parentId) continue;
    changed.push({
      pageId: m.id,
      title: m.title,
      path: m.path,
      languageCode: code(m.languageId),
      change: e ? 'modified' : 'added',
      updatedAt: m.updatedAt.toISOString(),
    });
  }
  for (const [mainId, e] of Object.entries(baseline.pages)) {
    if (!onMain.has(mainId)) {
      changed.push({ pageId: mainId, title: e.title, path: e.path, languageCode: code(e.languageId), change: 'deleted', updatedAt: e.updatedAt });
    }
  }
  return changed.sort(byPath);
};
