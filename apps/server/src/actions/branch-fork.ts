import { createHash } from 'node:crypto';
import { type PageKind, Prisma } from '@nibleaf/database';
import { joinPath } from '@nibleaf/shared/utils';

/**
 * Fork tracking for versions (non-default branches).
 *
 * When a version is copied from main we record `forkedAt` and a baseline of
 * main's pages at that moment (see {@link ForkBaseline}): for each main page,
 * the id of the version's copy, a hash of what the page says (see
 * {@link pageContentHash}), each field's value (see {@link FIELD_SQL}), its
 * parent and its position. "Promote into main" compares both sides against it,
 * three-way, field by field.
 *
 * Identity: promote updates main's pages IN PLACE from the version's copies and
 * then deletes the copies. Main page ids never change, so other open versions'
 * baselines stay valid across successive promotions, and comments and reader
 * grants on main pages survive. Comments and grants on a consumed copy move to
 * its main page.
 *
 * Three-way merge, per main page at the fork:
 *  - Each field (title, slug, icon, description, visibility, translation key,
 *    kind, content, settings), the parent and the position take the version's
 *    value only where the version changed it; everything else keeps main's
 *    current value. When both sides changed the same field, the version wins
 *    (`onPromote: 'replaced'`); when they changed different fields, both edits
 *    are kept (`'merged'`).
 *  - Baselines recorded before per-field values existed (#334) have no
 *    `fields`: a page both sides changed is then replaced whole by the
 *    version's copy, listed as `'replaced'` and covered by the confirmation.
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
 *    listed as `conflict`. A page staying where it is keeps the address (then
 *    a main page, then the lowest id); a page whose address changes in this
 *    promote (it moves in, the version moved or renamed it, or it is re-homed
 *    because its parent goes away) is the one renamed. Clashes are settled
 *    top-down, so a renamed folder's pages follow it. Duplicates that were
 *    already on main and that the promote does not touch are left alone.
 *  - Cycles: if combining both sides' moves would put pages inside each other,
 *    promote is refused (409 `branch:promote_blocked`) and the pages are listed
 *    as `conflict` / `blocked`; confirming does not override it.
 *
 * A version forked from another version inherits that version's baseline:
 * each copy id is remapped onto the new copies (the old one is kept in `aka`,
 * in case a promote put that copy onto main), and the source's own pages are
 * added as entries with `origin: 'version'`, keyed by the source page id. The
 * source's baseline gains the mirror entries, keyed by the new copies' ids. So
 * whichever of the two is promoted first, its pages land on main under ids the
 * other one knows, and the later promote folds into them instead of
 * duplicating them.
 *
 * When a promote puts pages onto main, every other version's baseline records
 * it (`reachedMain`, and the main id in `aka`). An `origin: 'version'` page
 * that reached main and is gone again was deleted on main, and gets the
 * deleted-on-main rules instead of being brought back as new.
 *
 * Not promoted at all (409 `branch:baseline_missing`): a version without a
 * baseline (created before fork tracking, or forked from such a version), or
 * one whose baseline knows none of main's pages any more (main was replaced,
 * for example by an import, after the fork).
 */

/** What a page says, as one hash: everything a reader or the page settings
 *  see, except its place in the tree (parent and position are compared
 *  separately, against logical ids). The same SQL hashes main pages and their
 *  copies, at the fork and at promote time. */
export const pageContentHash = () =>
  Prisma.sql`md5(json_build_array("kind", "title", "slug", "icon", "description", "content", "config", "translationKey", "hidden")::text)`;

/** Per-field values, as SQL: the plain columns, and hashes of content and
 *  settings so the baseline stays small. Used verbatim in the fork read and
 *  the promote read. */
export const FIELD_SQL = () =>
  Prisma.sql`"slug", "title", "icon", "description", "hidden", "translationKey", "kind"::text AS "kind", md5(coalesce("content", '')) AS "contentHash", md5(coalesce("config"::text, '')) AS "configHash"`;

export type PageFields = {
  slug: string;
  title: string;
  icon: string | null;
  description: string | null;
  hidden: boolean;
  translationKey: string | null;
  kind: PageKind;
  contentHash: string;
  configHash: string;
};

const FIELD_KEYS = ['slug', 'title', 'icon', 'description', 'hidden', 'translationKey', 'kind', 'contentHash', 'configHash'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
const pickFields = (p: PageFields): PageFields => Object.fromEntries(FIELD_KEYS.map((k) => [k, p[k]])) as PageFields;

type ForkBaselineEntry = {
  /** The version's copy of this page. */
  copyId: string;
  /** Content hash of the page at the fork. */
  hash: string;
  /** Content hash of the copy right after it was made (equal unless copying
   *  normalized a value). */
  copyHash: string;
  /** Parent at the fork, as a baseline key. */
  parentId: string | null;
  position: number;
  /** The page's `updatedAt` at the fork (ISO). */
  updatedAt: string;
  title: string;
  path: string;
  languageId: string;
  kind: PageKind;
  /** Additive (absent in baselines #334 recorded): each field at the fork. */
  fields?: PageFields;
  /** Additive: the copy's settings hash, when copying changed it (a JSON null
   *  setting is stored as no settings). */
  copyConfigHash?: string;
  /** Additive: the key is a page a source version created (chained forks). */
  origin?: 'version';
  /** Additive: other ids the page may have on main (a source version's copy
   *  that a promote of that version put onto main). */
  aka?: string[];
  /** Additive: a promote of another version has put this page onto main. */
  reachedMain?: boolean;
};

/** Marks a baseline this code wrote. #334 wrote the same v2 shape without the
 *  bookkeeping a merge needs (per-field values, the source's own pages, mirror
 *  entries, landing records), and nothing else tells its baselines apart, by
 *  timing or by content. A baseline without the marker is not trusted. */
const PROVENANCE = 'three-way';

/** Main's pages at the fork, keyed by main page id (or, for `origin:
 *  'version'` entries, by the source version's page id). */
type ForkBaseline = { version: 2; provenance: typeof PROVENANCE; pages: Record<string, ForkBaselineEntry> };

/** One page row as promote reads it (both branches, one locked query). */
export type PromotePageRow = PageFields & {
  id: string;
  parentId: string | null;
  path: string;
  languageId: string;
  position: number;
  updatedAt: Date;
  hash: string;
};

type OnPromote = 'kept' | 'merged' | 'replaced' | 'removed' | 'restored' | 'renamed' | 'moved' | 'blocked';

type ChangedOnMainPage = {
  /** Main page id (for a deleted page, the id it had). For `conflict`, the
   *  page being renamed or blocked, which may be a version page. */
  pageId: string;
  title: string;
  path: string;
  languageCode: string;
  change: 'modified' | 'added' | 'deleted' | 'conflict';
  /** What promote will do with it. `removed`: the page is not on main
   *  afterwards, and its comments and reader grants go with it. */
  onPromote: OnPromote;
  /** `renamed` only: the page's new address. */
  newPath?: string;
  /** `moved` only: the address of its new parent (null: the top level). */
  newParentPath?: string | null;
  /** `replaced` only: what of main's own edits the version overwrites
   *  (field names, plus `content`, `settings`, `parent`). */
  replacedFields?: string[];
  /** When main last changed the page. For a deleted page, its last known
   *  `updatedAt` before the fork (the deletion time is not recorded). */
  updatedAt: string;
};

export type MergePreview = {
  changedOnMainSinceFork: ChangedOnMainPage[];
  baselineComplete: boolean;
  /** Send back as `confirmPreview` to promote exactly this list. */
  fingerprint: string;
};

type FieldData = Partial<Pick<PageFields, 'slug' | 'title' | 'icon' | 'description' | 'hidden' | 'translationKey' | 'kind'>>;

/** Writes, all keyed to rows promote has locked and read. */
export type PromotePlan = {
  /** Main pages updated in place: plain fields in `data`; content and
   *  settings copied from the named version copy. */
  mainUpdates: Array<{
    id: string;
    contentFrom?: string;
    configFrom?: string;
    data: FieldData & { parentId?: string | null; position?: number };
  }>;
  /** Version pages that become main pages (keeping their ids). */
  moves: Array<{ id: string; data: { parentId: string | null; slug?: string } }>;
  /** Version copies folded into a main page: comments and grants move, then
   *  the copy goes. */
  consumed: Array<{ copyId: string; mainId: string }>;
  /** Untouched copies of pages deleted on main. */
  dropVersionIds: string[];
  /** Main pages the version deleted. */
  deleteMainIds: string[];
  /** Final addresses that come from the version: a main page created after
   *  the read at one of these would collide. */
  incoming: Array<{ languageId: string; path: string }>;
  /** Combining both sides would create a parent cycle: promote must refuse. */
  blocked: boolean;
  /** Every surviving page's final path, by id. */
  finalPaths: Map<string, string>;
  /** Pages that land on main under a new id, with every id the other
   *  versions may know them by. */
  landed: Array<{ id: string; lineage: string[] }>;
};

type ForkSourceRow = PageFields & {
  id: string;
  parentId: string | null;
  path: string;
  languageId: string;
  position: number;
  updatedAt: Date;
  hash: string;
};

/** The baseline of a fresh fork of main. `copy` gives each copy's id and its
 *  hashes as read right after it was made. */
export const buildForkBaseline = (
  mainPages: ForkSourceRow[],
  copyOf: (mainPageId: string) => { id: string; hash: string; configHash: string },
): Prisma.InputJsonObject => {
  const pages: Record<string, ForkBaselineEntry> = {};
  for (const p of mainPages) {
    const copy = copyOf(p.id);
    pages[p.id] = {
      copyId: copy.id,
      hash: p.hash,
      copyHash: copy.hash,
      parentId: p.parentId,
      position: p.position,
      updatedAt: p.updatedAt.toISOString(),
      title: p.title,
      path: p.path,
      languageId: p.languageId,
      kind: p.kind,
      fields: pickFields(p),
      ...(copy.configHash !== p.configHash ? { copyConfigHash: copy.configHash } : {}),
    };
  }
  return { version: 2, provenance: PROVENANCE, pages } satisfies ForkBaseline;
};

/** The baseline for a version forked from another version (`source`): the
 *  same entries, with each copy id remapped onto the new copies and the old
 *  copy id kept in `aka`; hashes stay as at the original fork, so the source's
 *  edits count as this version's. An entry whose copy the source deleted keeps
 *  a copy id that no longer exists, so it reads as "deleted in the version".
 *  The source's own pages (created or restored in it) become `origin:
 *  'version'` entries, keyed by their source page id. */
export const inheritForkBaseline = (
  source: ForkBaseline,
  sourcePages: ForkSourceRow[],
  copyOf: (sourcePageId: string) => { id: string; hash: string; configHash: string } | undefined,
): Prisma.InputJsonObject => {
  const pages: Record<string, ForkBaselineEntry> = {};
  const sourceCopyToKey = new Map<string, string>();
  for (const [key, e] of Object.entries(source.pages)) {
    sourceCopyToKey.set(e.copyId, key);
    const copy = copyOf(e.copyId);
    pages[key] = { ...e, copyId: copy?.id ?? e.copyId, aka: [...(e.aka ?? []), e.copyId] };
  }
  for (const p of sourcePages) {
    if (sourceCopyToKey.has(p.id)) continue;
    const copy = copyOf(p.id);
    if (!copy) continue;
    pages[p.id] = {
      copyId: copy.id,
      hash: p.hash,
      copyHash: copy.hash,
      parentId: p.parentId ? (sourceCopyToKey.get(p.parentId) ?? p.parentId) : null,
      position: p.position,
      updatedAt: p.updatedAt.toISOString(),
      title: p.title,
      path: p.path,
      languageId: p.languageId,
      kind: p.kind,
      fields: pickFields(p),
      ...(copy.configHash !== p.configHash ? { copyConfigHash: copy.configHash } : {}),
      origin: 'version',
    };
  }
  return { version: 2, provenance: PROVENANCE, pages } satisfies ForkBaseline;
};

const isFields = (value: unknown): value is PageFields => {
  if (!value || typeof value !== 'object') return false;
  const f = value as Record<string, unknown>;
  const nullableString = (v: unknown) => v === null || typeof v === 'string';
  return (
    typeof f.slug === 'string' &&
    typeof f.title === 'string' &&
    nullableString(f.icon) &&
    nullableString(f.description) &&
    typeof f.hidden === 'boolean' &&
    nullableString(f.translationKey) &&
    (f.kind === 'PAGE' || f.kind === 'GROUP') &&
    typeof f.contentHash === 'string' &&
    typeof f.configHash === 'string'
  );
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
    (e.kind === 'PAGE' || e.kind === 'GROUP') &&
    (e.fields === undefined || isFields(e.fields)) &&
    (e.copyConfigHash === undefined || typeof e.copyConfigHash === 'string') &&
    (e.origin === undefined || e.origin === 'version') &&
    (e.aka === undefined || (Array.isArray(e.aka) && e.aka.every((id) => typeof id === 'string'))) &&
    (e.reachedMain === undefined || typeof e.reachedMain === 'boolean')
  );
};

/** Read a stored baseline. Anything unexpected is treated as "no baseline"
 *  rather than trusted: the unreleased v1 shape, and any baseline without
 *  this code's provenance marker (a fresh or inherited #334 baseline), however
 *  its timestamps look. Such a version is refused (`branch:baseline_missing`),
 *  and a version forked from it gets no baseline either. */
const parseForkBaseline = (value: Prisma.JsonValue | null): ForkBaseline | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { version, provenance, pages } = value as Record<string, unknown>;
  if (version !== 2 || provenance !== PROVENANCE || !pages || typeof pages !== 'object' || Array.isArray(pages)) return null;
  return Object.values(pages).every(isEntry) ? (value as ForkBaseline) : null;
};

export const baselineOf = (branch: { forkedAt: Date | null; forkBaseline: Prisma.JsonValue | null }): ForkBaseline | null =>
  branch.forkedAt ? parseForkBaseline(branch.forkBaseline) : null;

/** The source version's baseline after forking it: for each page the source
 *  created, an `origin: 'version'` entry keyed by the new copy's id (whose
 *  copy is the source page), with the fork as base. If the new version is
 *  promoted first, the source then folds its page into the one that landed. */
export const addForkCounterparts = (
  source: ForkBaseline,
  sourcePages: ForkSourceRow[],
  copyOf: (sourcePageId: string) => { id: string; hash: string; configHash: string } | undefined,
): Prisma.InputJsonObject => {
  const pages: Record<string, ForkBaselineEntry> = { ...source.pages };
  const sourceCopyToKey = new Map(Object.entries(source.pages).map(([key, e]) => [e.copyId, key]));
  const keyOf = (pageId: string | null) => (pageId ? (sourceCopyToKey.get(pageId) ?? copyOf(pageId)?.id ?? pageId) : null);
  for (const p of sourcePages) {
    if (sourceCopyToKey.has(p.id)) continue;
    const copy = copyOf(p.id);
    if (!copy) continue;
    pages[copy.id] = {
      copyId: p.id,
      hash: copy.hash,
      copyHash: p.hash,
      parentId: keyOf(p.parentId),
      position: p.position,
      updatedAt: p.updatedAt.toISOString(),
      title: p.title,
      path: p.path,
      languageId: p.languageId,
      kind: p.kind,
      fields: { ...pickFields(p), configHash: copy.configHash },
      ...(copy.configHash !== p.configHash ? { copyConfigHash: p.configHash } : {}),
      origin: 'version',
    };
  }
  return { version: 2, provenance: PROVENANCE, pages } satisfies ForkBaseline;
};

/** Another version's baseline after a promote put `landed` pages onto main:
 *  each entry known by one of a landed page's lineage ids now knows its main
 *  id (`aka`) and that it reached main. Null when nothing changed. */
export const recordLanded = (baseline: ForkBaseline, landed: PromotePlan['landed']): Prisma.InputJsonObject | null => {
  const byLineage = new Map<string, string>();
  for (const { id, lineage } of landed) for (const known of lineage) byLineage.set(known, id);
  let changed = false;
  const pages: Record<string, ForkBaselineEntry> = {};
  for (const [key, e] of Object.entries(baseline.pages)) {
    const mainId = byLineage.get(key) ?? e.aka?.map((known) => byLineage.get(known)).find(Boolean);
    if (!mainId) {
      pages[key] = e;
      continue;
    }
    changed = true;
    const aka = mainId === key || e.aka?.includes(mainId) ? e.aka : [...(e.aka ?? []), mainId];
    pages[key] = { ...e, ...(aka ? { aka } : {}), reachedMain: true };
  }
  return changed ? ({ version: 2, provenance: PROVENANCE, pages } satisfies ForkBaseline) : null;
};

const byPath = (a: ChangedOnMainPage, b: ChangedOnMainPage) =>
  a.path.localeCompare(b.path, 'en') ||
  a.languageCode.localeCompare(b.languageCode, 'en') ||
  a.change.localeCompare(b.change, 'en') ||
  a.pageId.localeCompare(b.pageId, 'en');

/** What the writer reviewed, as one value: sha256 over the sorted
 *  `pageId|change|onPromote|updatedAt|newPath|newParentPath|replacedFields`
 *  lines. `updatedAt` counts only where main's own edit is lost (`replaced`,
 *  `removed`): a later edit to a page main keeps changes nothing reviewed. */
export const previewFingerprint = (changed: ChangedOnMainPage[]) =>
  createHash('sha256')
    .update(
      changed
        .map((c) =>
          [
            c.pageId,
            c.change,
            c.onPromote,
            c.onPromote === 'replaced' || c.onPromote === 'removed' ? c.updatedAt : '',
            c.newPath ?? '',
            c.newParentPath === undefined ? '' : (c.newParentPath ?? '/'),
            (c.replacedFields ?? []).join(','),
          ].join('|'),
        )
        .sort()
        .join('\n'),
    )
    .digest('hex');

const KEY = '\u0000';
const SIMPLE_FIELDS = ['slug', 'title', 'icon', 'description', 'hidden', 'translationKey', 'kind'] as const;

/** Compare main and the version with the fork point: what changed on main (the
 *  preview, sorted by path) and what promote will write (the plan). Null when
 *  the baseline knows none of main's pages any more: promote must refuse. */
export const analyzePromote = (
  mainPages: PromotePageRow[],
  versionPages: PromotePageRow[],
  baseline: ForkBaseline,
  languageCodes: Map<string, string>,
): { preview: MergePreview; plan: PromotePlan } | null => {
  const changed: ChangedOnMainPage[] = [];
  const byPageId = new Map<string, ChangedOnMainPage[]>();
  const code = (languageId: string) => languageCodes.get(languageId) ?? '';
  const push = (entry: ChangedOnMainPage) => {
    changed.push(entry);
    const list = byPageId.get(entry.pageId);
    if (list) list.push(entry);
    else byPageId.set(entry.pageId, [entry]);
  };
  const list = (
    p: { title: string; path: string; languageId: string },
    pageId: string,
    change: ChangedOnMainPage['change'],
    onPromote: OnPromote,
    updatedAt: string,
  ) => push({ pageId, title: p.title, path: p.path, languageCode: code(p.languageId), change, onPromote, updatedAt });

  const mainById = new Map(mainPages.map((p) => [p.id, p]));
  const versionById = new Map(versionPages.map((p) => [p.id, p]));
  const plan: PromotePlan = {
    mainUpdates: [],
    moves: [],
    consumed: [],
    dropVersionIds: [],
    deleteMainIds: [],
    incoming: [],
    blocked: false,
    finalPaths: new Map(),
    landed: [],
  };
  const deleteMain = new Set<string>();
  /** Version page id → the main id it is folded into. */
  const foldedInto = new Map<string, string>();
  const moved = new Set<string>();
  type MainUpdate = PromotePlan['mainUpdates'][number];
  const mainData = new Map<string, MainUpdate>();
  /** Main pages whose slug the version set. */
  const versionSlug = new Set<string>();
  /** Version pages whose version parent decides their final parent. */
  const usesVersionParent = new Set<string>();

  const onMainOf = (key: string, e: ForkBaselineEntry) => (mainById.has(key) ? key : e.aka?.find((id) => mainById.has(id)));
  const allEntries = Object.entries(baseline.pages).sort(([a], [b]) => a.localeCompare(b, 'en'));
  // Main was replaced since the fork (an import gives every page a new id):
  // nothing here can be matched, so nothing can be merged safely. Imports
  // already clear other versions' fork points; this is the backstop. It also
  // refuses, more cautiously than needed, a version whose fork-time pages were
  // all deleted on main by hand and replaced with new ones.
  const mainEntries = allEntries.filter(([, e]) => e.origin !== 'version');
  if (mainPages.length > 0 && mainEntries.length > 0 && !mainEntries.some(([key, e]) => onMainOf(key, e))) return null;
  // One entry per copy. A source page forked into several versions has an
  // entry per counterpart; the one on main wins, then one that reached main.
  const rank = ([key, e]: [string, ForkBaselineEntry]) => (onMainOf(key, e) ? 0 : e.reachedMain ? 1 : 2);
  const chosen = new Map<string, [string, ForkBaselineEntry]>();
  for (const pair of allEntries) {
    const current = chosen.get(pair[1].copyId);
    if (!current || rank(pair) < rank(current)) chosen.set(pair[1].copyId, pair);
  }
  const entries = [...chosen.values()];
  // Where each baseline page lives on main now, if anywhere (its key, or an
  // older copy id a promote put there).
  const keyToMain = new Map<string, string>();
  const mainToKey = new Map<string, string>();
  for (const [key, e] of entries) {
    const onMain = onMainOf(key, e);
    if (onMain && !mainToKey.has(onMain)) {
      keyToMain.set(key, onMain);
      mainToKey.set(onMain, key);
    }
  }
  const copyToKey = new Map(entries.map(([key, e]) => [e.copyId, key]));
  const keyOfMainParent = (id: string | null) => (id ? (mainToKey.get(id) ?? id) : null);
  const logicalParent = (copy: PromotePageRow) => (copy.parentId ? (copyToKey.get(copy.parentId) ?? copy.parentId) : null);
  const restoreCandidates = new Map<string, string>(); // copy id → baseline key (deleted on main, copy untouched)

  for (const [key, e] of entries) {
    const mainId = keyToMain.get(key);
    const m = mainId ? mainById.get(mainId) : undefined;
    const copy = versionById.get(e.copyId);
    const versionContent = copy ? copy.hash !== e.copyHash : false;
    const versionParent = copy ? logicalParent(copy) !== e.parentId : false;
    const versionEdited = versionContent || versionParent;
    if (m && mainId) {
      const mainContent = m.hash !== e.hash;
      const mainParent = keyOfMainParent(m.parentId) !== e.parentId;
      const mainEdited = mainContent || mainParent;
      if (!copy) {
        deleteMain.add(mainId);
        // A page another version put on main after this version's fork: its
        // entry's hash is the copy's own, so main never reads as edited.
        // Removing it always needs the writer's confirmation.
        if (e.origin === 'version' || e.reachedMain) list(m, mainId, 'added', 'removed', m.updatedAt.toISOString());
        else if (mainEdited) list(m, mainId, 'modified', 'removed', m.updatedAt.toISOString());
        continue;
      }
      foldedInto.set(copy.id, mainId);
      plan.consumed.push({ copyId: copy.id, mainId });
      const update: MainUpdate = { id: mainId, data: {} };
      const replaced: string[] = versionParent && mainParent ? ['parent'] : [];
      if (versionContent) {
        const base = e.fields;
        if (base) {
          // Three-way, field by field: the version wins only where it changed.
          const baseCopy = (k: FieldKey) => (k === 'configHash' ? (e.copyConfigHash ?? base.configHash) : base[k]);
          const versionChanged = (k: FieldKey) => copy[k] !== baseCopy(k);
          for (const k of SIMPLE_FIELDS) {
            if (!versionChanged(k) || copy[k] === m[k]) continue;
            if (m[k] !== base[k]) replaced.push(k);
            (update.data as Record<string, unknown>)[k] = copy[k];
            if (k === 'slug') versionSlug.add(mainId);
          }
          if (versionChanged('contentHash') && copy.contentHash !== m.contentHash) {
            if (m.contentHash !== base.contentHash) replaced.push('content');
            update.contentFrom = copy.id;
          }
          // Settings are merged as a whole: if both sides changed them, the
          // version's settings win, listed as replaced.
          if (versionChanged('configHash') && copy.configHash !== m.configHash) {
            if (m.configHash !== base.configHash) replaced.push('settings');
            update.configFrom = copy.id;
          }
        } else {
          // No per-field baseline (#334): take the copy whole. When main also
          // changed the page this replaces main's edits, so it is listed.
          const written: string[] = [];
          for (const k of SIMPLE_FIELDS) {
            if (copy[k] !== m[k]) {
              (update.data as Record<string, unknown>)[k] = copy[k];
              written.push(k);
            }
          }
          if (copy.slug !== m.slug) versionSlug.add(mainId);
          if (copy.contentHash !== m.contentHash) {
            update.contentFrom = copy.id;
            written.push('content');
          }
          if (copy.configHash !== m.configHash) {
            update.configFrom = copy.id;
            written.push('settings');
          }
          if (mainContent) replaced.push(...(written.length > 0 ? written : ['content']));
        }
      }
      if (versionParent) usesVersionParent.add(copy.id);
      if (copy.position !== e.position) update.data.position = copy.position;
      mainData.set(mainId, update);
      if (mainEdited) {
        list(m, mainId, 'modified', replaced.length > 0 ? 'replaced' : versionEdited ? 'merged' : 'kept', m.updatedAt.toISOString());
        if (replaced.length > 0) {
          const entry = changed.at(-1);
          if (entry) entry.replacedFields = [...new Set(replaced)].sort();
        }
      }
    } else if (e.origin === 'version' && !e.reachedMain) {
      // A page a source version created that never reached main: it is this
      // version's own. (One that reached main and is gone again was deleted
      // on main, and falls through to those rules.)
      if (copy) {
        moved.add(copy.id);
        usesVersionParent.add(copy.id);
      }
    } else if (copy && versionEdited) {
      moved.add(copy.id);
      usesVersionParent.add(copy.id);
    } else if (copy) {
      restoreCandidates.set(copy.id, key);
    } else {
      list(e, key, 'deleted', 'removed', e.updatedAt);
    }
  }
  for (const p of versionPages) {
    if (!copyToKey.has(p.id)) {
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
  for (const [key, e] of entries) {
    if (keyToMain.has(key) || (e.origin === 'version' && !e.reachedMain) || !versionById.has(e.copyId)) continue;
    list(e, key, 'deleted', moved.has(e.copyId) ? 'restored' : 'removed', e.updatedAt);
  }
  plan.dropVersionIds = [...restoreCandidates.keys()];
  for (const p of mainPages) {
    if (!mainToKey.has(p.id)) list(p, p.id, 'added', 'kept', p.updatedAt.toISOString());
  }

  // Final parents. A version parent maps to the main page it is folded into.
  const resolveVersionParent = (parentId: string | null) => (parentId ? (foldedInto.get(parentId) ?? parentId) : null);
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
  const survives = (id: string) => finalParent.has(id);
  const nearestKept = (parentId: string | null): string | null => {
    const seen = new Set<string>();
    let current = parentId;
    while (current && !seen.has(current)) {
      seen.add(current);
      if (survives(current)) return current;
      current = mainById.get(current)?.parentId ?? null;
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
        const update = mainData.get(id) ?? { id, data: {} };
        update.data.parentId = next;
        mainData.set(id, update);
      }
    }
  }

  const rowOf = (id: string) => (moved.has(id) ? versionById.get(id) : (mainById.get(id) ?? versionById.get(id)));
  const titleOf = (id: string) => mainData.get(id)?.data.title ?? rowOf(id)?.title ?? '';

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
      push({
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
  const slugOf = (id: string) => mainData.get(id)?.data.slug ?? rowOf(id)?.slug ?? '';
  const languageOf = (id: string) => rowOf(id)?.languageId ?? '';
  /** The page's address changes in this promote: it moves in, the version
   *  placed or renamed it, or it is re-homed. A content-only edit does not
   *  count. */
  const addressMoves = (id: string) => moved.has(id) || versionPlaced.has(id) || versionSlug.has(id) || rehomed.has(id);
  const renamedSlug = new Map<string, string>();
  const finalPath = new Map<string, string>();
  const parentPathOf = (id: string): string | null => {
    const parent = finalParent.get(id) ?? null;
    return parent ? (finalPath.get(parent) ?? null) : null;
  };
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
    for (const id of finalParent.keys()) {
      const d = depthOf(id);
      const level = levels.get(d);
      if (level) level.push(id);
      else levels.set(d, [id]);
    }
    for (const d of [...levels.keys()].sort((a, b) => a - b)) {
      const ids = (levels.get(d) ?? []).sort();
      const groups = new Map<string, string[]>();
      for (const id of ids) {
        const path = joinPath(parentPathOf(id), slugOf(id));
        finalPath.set(id, path);
        const key = `${languageOf(id)}${KEY}${path}`;
        const group = groups.get(key);
        if (group) group.push(id);
        else groups.set(key, [id]);
      }
      const taken = new Set(groups.keys());
      for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
        if (group.length < 2 || !group.some(addressMoves)) continue;
        const [, ...others] = [...group].sort(
          (a, b) =>
            Number(addressMoves(a)) - Number(addressMoves(b)) ||
            Number(!mainById.has(a) || moved.has(a)) - Number(!mainById.has(b) || moved.has(b)) ||
            a.localeCompare(b, 'en'),
        );
        for (const id of others) {
          // Duplicates already on main that this promote does not touch stay.
          if (!addressMoves(id)) continue;
          const slug = slugOf(id);
          const parentPath = parentPathOf(id);
          let n = 2;
          let candidate = `${slug}-${n}`;
          while (taken.has(`${languageOf(id)}${KEY}${joinPath(parentPath, candidate)}`)) candidate = `${slug}-${++n}`;
          const newPath = joinPath(parentPath, candidate);
          taken.add(`${languageOf(id)}${KEY}${newPath}`);
          renamedSlug.set(id, candidate);
          finalPath.set(id, newPath);
          push({
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
    for (const id of rehomed) {
      const parentPath = parentPathOf(id);
      const entry = byPageId.get(id)?.find((c) => c.change === 'added' || c.change === 'modified');
      if (entry) {
        if (entry.onPromote === 'kept') entry.onPromote = 'moved';
        entry.newParentPath = parentPath;
      } else {
        const r = mainById.get(id);
        if (r) push({ ...rowEntry(r, id, code), change: 'modified', onPromote: 'moved', newParentPath: parentPath });
      }
    }
    for (const [id, path] of finalPath) {
      if (addressMoves(id) || renamedSlug.has(id)) plan.incoming.push({ languageId: languageOf(id), path });
    }
  }

  for (const [id, update] of mainData) {
    const slug = renamedSlug.get(id);
    const data = { ...update.data, ...(slug ? { slug } : {}) };
    if (!update.contentFrom && !update.configFrom && Object.keys(data).length === 0) continue;
    plan.mainUpdates.push({ ...update, data });
  }
  for (const id of [...moved].sort()) {
    const slug = renamedSlug.get(id);
    plan.moves.push({ id, data: { parentId: finalParent.get(id) ?? null, ...(slug ? { slug } : {}) } });
  }
  plan.deleteMainIds = [...deleteMain];
  plan.finalPaths = finalPath;
  for (const id of moved) {
    const pair = chosen.get(id);
    plan.landed.push({ id, lineage: [id, ...(pair ? [pair[0], ...(pair[1].aka ?? [])] : [])] });
  }
  const sorted = changed.sort(byPath);
  return { preview: { changedOnMainSinceFork: sorted, baselineComplete: true, fingerprint: previewFingerprint(sorted) }, plan };
};

const rowEntry = (r: PromotePageRow, id: string, code: (languageId: string) => string) => ({
  pageId: id,
  title: r.title,
  path: r.path,
  languageCode: code(r.languageId),
  updatedAt: r.updatedAt.toISOString(),
});
