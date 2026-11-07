import { Prisma } from '@nibleaf/database';

/**
 * Fork baselines for versions (non-default branches).
 *
 * When a version is copied from main, main's pages are read and hashed in one
 * statement under the project lock, and the result is stored on the version as
 * its fork baseline: each main page id mapped to its content hash (plus what
 * the preview needs to name a page that has since been deleted). A version
 * copied from another version copies that version's baseline, because its
 * pages still derive from main as it was at that fork.
 *
 * "Promote into main" compares main against the baseline and refuses when
 * anything was modified, added or deleted. It never merges.
 */

/** Everything a page says, as one hash: title, slug, kind, content,
 *  description, icon, settings, translation key, hidden and parent, as a JSON
 *  tuple (so no value can be confused with a separator, and NULL stays
 *  distinct from an empty string). Position is left out on purpose: dragging a
 *  page in the tree rewrites its siblings' positions, which is not an edit.
 *
 *  Stored baselines depend on this exact expression. Changing the fields or
 *  their order makes every existing baseline look changed. */
export const pageContentHash = () =>
  Prisma.sql`md5(jsonb_build_array("title", "slug", "kind"::text, "content", "description", "icon", "config", "translationKey", "hidden", "parentId")::text)`;

type ForkBaselineEntry = {
  /** {@link pageContentHash} of the main page at the fork. */
  hash: string;
  title: string;
  path: string;
  languageId: string;
  /** The main page's `updatedAt` at the fork (ISO). */
  updatedAt: string;
};

/** Main's pages at the fork, keyed by main page id. */
export type ForkBaseline = { version: 1; pages: Record<string, ForkBaselineEntry> };

/** A main page as read (and hashed) for the baseline or the comparison. */
export type HashedPageRow = { id: string; title: string; path: string; languageId: string; updatedAt: Date; hash: string };

export const buildForkBaseline = (mainPages: HashedPageRow[]): ForkBaseline => {
  const pages: Record<string, ForkBaselineEntry> = {};
  for (const p of mainPages) {
    pages[p.id] = { hash: p.hash, title: p.title, path: p.path, languageId: p.languageId, updatedAt: p.updatedAt.toISOString() };
  }
  return { version: 1, pages };
};

const isEntry = (value: unknown): value is ForkBaselineEntry => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.hash === 'string' &&
    typeof e.title === 'string' &&
    typeof e.path === 'string' &&
    typeof e.languageId === 'string' &&
    typeof e.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(e.updatedAt))
  );
};

/** A version's stored baseline, or null when it has none it can trust: no
 *  fork time, no baseline, or a value of any unexpected shape. */
export const parseForkBaseline = (branch: { forkedAt: Date | null; forkBaseline: Prisma.JsonValue | null }): ForkBaseline | null => {
  const value = branch.forkBaseline;
  if (!branch.forkedAt || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { version, pages } = value as Record<string, unknown>;
  if (version !== 1 || !pages || typeof pages !== 'object' || Array.isArray(pages)) return null;
  return Object.values(pages).every(isEntry) ? (value as ForkBaseline) : null;
};

export type ChangedOnMainPage = {
  /** Main page id. For a deleted page, the id it had on main. */
  pageId: string;
  title: string;
  path: string;
  languageCode: string;
  change: 'modified' | 'added' | 'deleted';
  /** When main last changed the page. For a deleted page, its `updatedAt` at
   *  the fork (the deletion time is not recorded). */
  updatedAt: string;
};

export type MergePreview = { changedOnMainSinceFork: ChangedOnMainPage[]; baselineComplete: boolean };

const byPath = (a: ChangedOnMainPage, b: ChangedOnMainPage) =>
  a.path.localeCompare(b.path, 'en') ||
  a.languageCode.localeCompare(b.languageCode, 'en') ||
  a.change.localeCompare(b.change, 'en') ||
  a.pageId.localeCompare(b.pageId, 'en');

/** Main pages modified, added or deleted since the fork, sorted by path. */
export const changedOnMainSinceFork = (
  mainPages: HashedPageRow[],
  baseline: ForkBaseline,
  languageCodes: Map<string, string>,
): ChangedOnMainPage[] => {
  const code = (languageId: string) => languageCodes.get(languageId) ?? '';
  const changed: ChangedOnMainPage[] = [];
  const onMain = new Set<string>();
  for (const p of mainPages) {
    onMain.add(p.id);
    const entry = Object.hasOwn(baseline.pages, p.id) ? baseline.pages[p.id] : undefined;
    if (entry && entry.hash === p.hash) continue;
    changed.push({
      pageId: p.id,
      title: p.title,
      path: p.path,
      languageCode: code(p.languageId),
      change: entry ? 'modified' : 'added',
      updatedAt: p.updatedAt.toISOString(),
    });
  }
  for (const [pageId, e] of Object.entries(baseline.pages)) {
    if (onMain.has(pageId)) continue;
    changed.push({ pageId, title: e.title, path: e.path, languageCode: code(e.languageId), change: 'deleted', updatedAt: e.updatedAt });
  }
  return changed.sort(byPath);
};
