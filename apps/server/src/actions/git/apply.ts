import { Prisma } from '@nibleaf/database';
import { importedPageIcon } from '@nibleaf/shared/page-icons';
import { MAX_PAGE_CONTENT_BYTES, oversizedPageContent } from '@nibleaf/shared/page-limits';
import { themeContentLocation } from '@nibleaf/shared/theme-repository';
import { joinPath, slugifyUnicode } from '@nibleaf/shared/utils';
import { deriveTitle, humanize, parseFrontmatter } from '../importers/content';

/**
 * Applies a reconciled Git result to Nibleaf pages inside ONE caller-owned
 * transaction, so a sync either lands completely (pages + file ledger) or not
 * at all.
 *
 * Locking follows the shared page-write protocol: the project row first
 * (`FOR NO KEY UPDATE`), then every page row the apply touches — including the
 * whole subtree under a deletion — in ascending id order.
 *
 * A deletion never takes pages with it that must stay: when Git deletes a
 * page's own file but keeps files under it (or a page under it changed since
 * the merge read), the page becomes a folder group in place, so its sub-pages
 * keep their paths and their own ledger rows. Page moves and
 * creations take the same project lock, so the page tree cannot change under
 * the apply, and the apply cannot deadlock with them.
 *
 * Every write to a page the merge read is conditional on the revision it
 * observed: `updatedAt` AND the protected fields themselves, so even two saves
 * inside one millisecond cannot slip through. A miss rolls the whole apply
 * back with a {@link GitApplyConflictError} instead of overwriting the newer
 * edit.
 */

/** The page state the merge read. Writes are conditional on all of it. */
export type ObservedPage = {
  id: string;
  parentId: string | null;
  kind: 'PAGE' | 'GROUP';
  updatedAt: Date;
  title: string;
  content: string;
  description: string | null;
  icon: string | null;
};

/** One page change computed by reconciliation. */
export type GitContentChange =
  | { type: 'delete'; path: string; pageId: string }
  | { type: 'write'; path: string; pageId: string | null; content: string };

export interface GitApplyContext {
  projectId: string;
  contentPath: string;
  branch: { id: string; name: string };
  language: { id: string; code: string };
  snapshot: Parameters<typeof themeContentLocation>[1];
  /** Every page (any kind) of the authoring branch/language, as the merge read it. */
  observed: ReadonlyMap<string, ObservedPage>;
}

/** Raised when pages changed after the merge read them; re-reconciling decides
 * whether each really conflicts. Nothing was written. */
export class GitApplyConflictError extends Error {
  constructor(readonly paths: string[]) {
    super(`These pages changed while Git sync was running: ${paths.join(', ')}. Nothing was applied.`);
    this.name = 'GitApplyConflictError';
  }
}

/** Raised when a repository file would write a page body over
 * MAX_PAGE_CONTENT_BYTES (measured after decoding and frontmatter removal),
 * creating it or growing the stored body. Nothing was written. */
export class GitContentTooLargeError extends Error {
  constructor(readonly paths: string[]) {
    super(
      `These files are larger than the ${MAX_PAGE_CONTENT_BYTES / (1024 * 1024)} MiB page limit: ${paths.join(', ')}. Split them into smaller pages. Nothing was applied.`,
    );
    this.name = 'GitContentTooLargeError';
  }
}

/** Lock-protocol rule 1: never `FOR UPDATE`, which would block every insert
 * with a foreign key to the project. */
const lockProject = (tx: Prisma.TransactionClient, projectId: string) =>
  tx.$queryRaw`SELECT 1 FROM "project" WHERE "id" = ${projectId} FOR NO KEY UPDATE`;

/** Lock-protocol rule 3: page rows after the project row, ascending id. */
const lockPages = async (tx: Prisma.TransactionClient, ids: string[]) => {
  if (ids.length === 0) return;
  const sorted = [...new Set(ids)].sort();
  await tx.$queryRaw`SELECT "id" FROM "page" WHERE "id" IN (${Prisma.join(sorted)}) ORDER BY "id" FOR NO KEY UPDATE`;
};

const revisionFields = { updatedAt: true, title: true, content: true, description: true, icon: true } as const;

const configSidebarTitle = (config: unknown): string | null => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const value = (config as Record<string, unknown>).sidebarTitle;
  return typeof value === 'string' && value.trim() ? value : null;
};
type Revision = Pick<ObservedPage, 'updatedAt' | 'title' | 'content' | 'description' | 'icon'>;
const revisionWhere = (page: Revision) => ({
  updatedAt: page.updatedAt,
  title: page.title,
  content: page.content,
  description: page.description,
  icon: page.icon,
});
const sameRevision = (a: Revision, b: Revision) =>
  a.updatedAt.getTime() === b.updatedAt.getTime() &&
  a.title === b.title &&
  a.content === b.content &&
  a.description === b.description &&
  a.icon === b.icon;

/** A pulled file's page fields. Only icons the reader draws are written, or the
 *  icon the page already had (an older value round-trips unchanged). */
const pageData = (raw: string, existingIcon?: string | null) => {
  const parsed = parseFrontmatter(raw);
  return {
    content: parsed.body,
    ...(parsed.meta.title ? { title: parsed.meta.title.slice(0, 200) } : {}),
    description: parsed.meta.description?.slice(0, 500) ?? null,
    icon: importedPageIcon(parsed.meta.icon?.slice(0, 64), existingIcon),
  };
};

type TreeRow = { id: string; parentId: string | null; kind: 'PAGE' | 'GROUP'; slug: string; path: string; title: string; position: number };

/**
 * Creates pages for repository files Nibleaf has no page for yet. The sibling
 * index is read once under the project lock (nothing else can create pages
 * while it is held), so each new page is a single insert. A new file always
 * gets a NEW page with a sibling-unique slug: it never adopts an existing page
 * by slug, so two files whose names normalize alike cannot overwrite each other.
 */
class PageCreator {
  private readonly bySlug = new Map<string, Set<string>>();
  private readonly maxPosition = new Map<string, number>();
  private readonly groups: TreeRow[];
  private readonly scope: { projectId: string; branchId: string; languageId: string };

  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly context: GitApplyContext,
    rows: TreeRow[],
  ) {
    this.scope = { projectId: context.projectId, branchId: context.branch.id, languageId: context.language.id };
    this.groups = rows.filter((row) => row.kind === 'GROUP');
    for (const row of rows) this.remember(row.parentId, row.slug, row.position);
  }

  private key(parentId: string | null) {
    return parentId ?? '';
  }

  private remember(parentId: string | null, slug: string, position: number) {
    const key = this.key(parentId);
    const slugs = this.bySlug.get(key) ?? new Set<string>();
    slugs.add(slug);
    this.bySlug.set(key, slugs);
    this.maxPosition.set(key, Math.max(this.maxPosition.get(key) ?? -1, position));
  }

  /** A page this apply turned into a folder: new files under it join it
   * instead of creating a look-alike `-2` folder. */
  adoptGroup(row: TreeRow) {
    this.groups.push({ ...row, kind: 'GROUP' });
  }

  /** Pages this apply deleted free their slugs and stop being folders. */
  forget(rows: TreeRow[]) {
    const gone = new Set(rows.map((row) => row.id));
    for (const row of rows) this.bySlug.get(this.key(row.parentId))?.delete(row.slug);
    for (let index = this.groups.length - 1; index >= 0; index -= 1) {
      if (gone.has((this.groups[index] as TreeRow).id)) this.groups.splice(index, 1);
    }
  }

  private uniqueSlug(parentId: string | null, desired: string, fallback: string) {
    const base = slugifyUnicode(desired) || fallback;
    const taken = this.bySlug.get(this.key(parentId));
    for (let suffix = 1; ; suffix += 1) {
      const slug = suffix === 1 ? base : `${base}-${suffix}`;
      if (!taken?.has(slug)) return slug;
    }
  }

  private async insert(parent: { id: string | null; path: string | null }, kind: 'PAGE' | 'GROUP', title: string, slug: string, extra = {}) {
    const position = (this.maxPosition.get(this.key(parent.id)) ?? -1) + 1;
    const row = await this.tx.page.create({
      data: { ...this.scope, parentId: parent.id, kind, title, slug, path: joinPath(parent.path, slug), position, content: '', ...extra },
      select: { id: true, parentId: true, kind: true, slug: true, path: true, title: true, position: true },
    });
    this.remember(row.parentId, row.slug, row.position);
    return row;
  }

  /** Find-or-create a folder group: by slug, then by title (oldest first) —
   * the rule the importers use, so earlier syncs' groups are reused. */
  private async group(parent: { id: string | null; path: string | null }, segment: string) {
    const title = humanize(segment);
    const slug = slugifyUnicode(segment) || 'group';
    const siblings = this.groups.filter((row) => row.parentId === parent.id);
    const existing = siblings.find((row) => row.slug === slug) ?? siblings.find((row) => row.title === title);
    if (existing) return existing;
    const created = await this.insert(parent, 'GROUP', title, this.uniqueSlug(parent.id, slug, 'group'));
    this.groups.push(created);
    return created;
  }

  async create(path: string, raw: string): Promise<string> {
    const { branch, language } = this.context;
    // Repository layout v2: the default language/version lives at the content
    // root, other languages under `<lang>/`, other versions under `versions/<slug>/`.
    const location = themeContentLocation(path, this.context.snapshot, this.context.contentPath);
    if (!location || location.versionId !== branch.id || location.languageCode !== language.code) {
      throw new Error(
        `${path} is outside the ${branch.name}/${language.code} content folder this connection syncs. Move or remove the file, or change the connection's language and version.`,
      );
    }
    const segments = location.relative.split('/').filter(Boolean);
    const fileName = segments.pop() ?? 'index';
    const isIndex = /^(index|readme)$/i.test(fileName);
    const leafName = isIndex ? (segments.pop() ?? 'index') : fileName;
    let parent: { id: string | null; path: string | null } = { id: null, path: null };
    for (const segment of segments) parent = await this.group(parent, segment);
    const parsed = parseFrontmatter(raw);
    const created = await this.insert(parent, 'PAGE', deriveTitle(parsed.meta, parsed.body, leafName), this.uniqueSlug(parent.id, leafName, 'page'), {
      content: parsed.body,
      description: parsed.meta.description?.slice(0, 500) ?? null,
      icon: importedPageIcon(parsed.meta.icon?.slice(0, 64)),
    });
    return created.id;
  }
}

/**
 * Apply every change, or throw. Returns the page id each changed path now maps
 * to (null when it no longer maps to a page). Conflicts are collected across
 * all changes and raised together, so one retry surfaces every affected page.
 */
export const applyGitContentChanges = async (
  tx: Prisma.TransactionClient,
  context: GitApplyContext,
  changes: GitContentChange[],
): Promise<Map<string, string | null>> => {
  const pageIds = new Map<string, string | null>();
  if (changes.length === 0) return pageIds;
  const { projectId, observed } = context;

  // Rules 2 and 6: any applied change takes the project lock first.
  await lockProject(tx, projectId);
  const tree = await tx.page.findMany({
    where: { projectId, branchId: context.branch.id, languageId: context.language.id },
    select: { id: true, parentId: true, kind: true, slug: true, path: true, title: true, position: true },
  });
  const children = new Map<string, string[]>();
  for (const row of tree) {
    if (!row.parentId) continue;
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
  }
  const descendantsOf = (id: string): string[] => {
    const found: string[] = [];
    const stack = [...(children.get(id) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      found.push(next);
      stack.push(...(children.get(next) ?? []));
    }
    return found;
  };

  const deletions = changes.flatMap((change) => (change.type === 'delete' ? [change.pageId] : []));
  const subtrees = new Map(deletions.map((id) => [id, descendantsOf(id)]));
  const touched = [...changes.flatMap((change) => (change.pageId ? [change.pageId] : [])), ...[...subtrees.values()].flat()];
  // Rule 3: page rows after the project row, in id order. Once held, a write
  // that started earlier has committed and the reads below see it.
  await lockPages(tx, touched);
  const current = new Map(
    (
      await tx.page.findMany({
        where: { id: { in: [...new Set(touched)] }, projectId },
        select: { id: true, kind: true, config: true, branchId: true, languageId: true, ...revisionFields },
      })
    ).map((row) => [row.id, row]),
  );
  const deleting = new Set(deletions);
  const creator = new PageCreator(tx, context, tree);
  const treeById = new Map(tree.map((row) => [row.id, row]));
  const conflicts: string[] = [];
  const tooLarge: string[] = [];
  /** A descendant that must outlive the deletion of `id`'s page. */
  const mustStay = (id: string) => {
    const now = current.get(id);
    if (!now) return false;
    const before = observed.get(id);
    // Git still has this page's file, or someone changed it after the merge
    // read (its own revision-checked deletion, if any, then reports that).
    return (now.kind === 'PAGE' && !deleting.has(id)) || !(before && sameRevision(before, now));
  };

  // Deletions and folder conversions first, so files created below see the
  // tree as it will be (a converted page is their folder, a deleted slug is free).
  const ordered = [...changes.filter((change) => change.type === 'delete'), ...changes.filter((change) => change.type === 'write')];
  for (const change of ordered) {
    if (change.type === 'delete') {
      pageIds.set(change.path, null);
      const seen = observed.get(change.pageId);
      // Never delete a page the merge did not read: it is not part of this
      // sync's content, so only the link to it is dropped.
      if (!seen) continue;
      if (!current.has(change.pageId)) continue; // Already gone (or removed with its parent above).
      const subtree = subtrees.get(change.pageId) ?? [];
      const where = { id: change.pageId, projectId, kind: 'PAGE' as const, ...revisionWhere(seen) };
      if (subtree.some(mustStay)) {
        // Keep the sub-pages where they are: the page's own content goes, and it
        // stays as their folder. No sub-page moves, so no repository path changes.
        // Page-only settings go (SEO, layout, table of contents); a custom
        // sidebar label still names the folder. Visibility is kept, so the
        // sub-pages' visibility does not change.
        const sidebarTitle = configSidebarTitle(current.get(change.pageId)?.config);
        const kept = await tx.page.updateMany({
          where,
          data: { kind: 'GROUP', content: '', description: null, icon: null, config: sidebarTitle ? { sidebarTitle } : Prisma.DbNull },
        });
        if (kept.count === 0) {
          conflicts.push(change.path);
          continue;
        }
        // A folder is no imported file's page any more.
        await tx.pageGitImportSource.deleteMany({ where: { pageId: change.pageId } });
        const row = treeById.get(change.pageId);
        if (row) creator.adoptGroup(row);
        continue;
      }
      const deleted = await tx.page.deleteMany({ where });
      // Rows are locked, so a miss means the page changed after the merge read it.
      if (deleted.count === 0) conflicts.push(change.path);
      else {
        for (const id of [change.pageId, ...subtree]) current.delete(id);
        creator.forget([change.pageId, ...subtree].flatMap((id) => treeById.get(id) ?? []));
      }
      continue;
    }
    const seen = change.pageId ? observed.get(change.pageId) : undefined;
    // The decoded page body is held to the shared page rule: a blob within the
    // source-size limit can still decode larger (invalid UTF-8 becomes U+FFFD).
    // Updates compare with the stored body read under the page lock.
    const body = parseFrontmatter(change.content).body;
    const stored = change.pageId && seen ? current.get(change.pageId) : undefined;
    if (oversizedPageContent(body, stored?.content) !== null) {
      tooLarge.push(change.path);
      continue;
    }
    if (change.pageId && seen) {
      const updated = await tx.page.updateMany({
        where: { id: change.pageId, projectId, ...revisionWhere(seen) },
        data: pageData(change.content, seen.icon),
      });
      // A miss means the page was saved or deleted after the merge read it.
      if (updated.count === 0) conflicts.push(change.path);
      pageIds.set(change.path, change.pageId);
      continue;
    }
    const unseen = change.pageId ? current.get(change.pageId) : undefined;
    if (unseen && unseen.branchId === context.branch.id && unseen.languageId === context.language.id) {
      // A page of this branch and language the merge never read: it was
      // created after that read (a writer's new page whose path Git also
      // added). Never write it blind; re-reconciling reads its content.
      conflicts.push(change.path);
      continue;
    }
    // A stale link to a page outside this sync's branch and language is left
    // untouched; the file gets its own page here instead.
    pageIds.set(change.path, await creator.create(change.path, change.content));
  }
  if (conflicts.length > 0) throw new GitApplyConflictError(conflicts);
  if (tooLarge.length > 0) throw new GitContentTooLargeError(tooLarge);
  return pageIds;
};
