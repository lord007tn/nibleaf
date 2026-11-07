import type { Prisma } from '@nibleaf/database';
import { themeContentLocation } from '@nibleaf/shared/theme-repository';
import { joinPath, slugifyUnicode } from '@nibleaf/shared/utils';
import { deriveTitle, humanize, parseFrontmatter } from '../importers/content';

/**
 * Applies a reconciled Git result to Nibleaf pages inside ONE caller-owned
 * transaction, so a sync either lands completely (pages + file ledger) or not
 * at all. Every write to a page the merge read is conditional on the
 * `updatedAt` it observed: a dashboard save that lands between the merge read
 * and this apply makes the write miss, and the whole apply is rolled back with
 * a {@link GitApplyConflictError} instead of overwriting the newer edit.
 */

/** One page change computed by reconciliation. `observedUpdatedAt` is the
 * page revision the merge read; null when the page was not part of that read. */
export type GitContentChange =
  | { type: 'delete'; path: string; pageId: string; observedUpdatedAt: Date | null }
  | { type: 'write'; path: string; pageId: string | null; observedUpdatedAt: Date | null; content: string };

export interface GitApplyContext {
  projectId: string;
  contentPath: string;
  branch: { id: string; name: string };
  language: { id: string; code: string };
  snapshot: Parameters<typeof themeContentLocation>[1];
}

/** Raised when pages changed after the merge read them. Nothing was written. */
export class GitApplyConflictError extends Error {
  constructor(readonly paths: string[]) {
    super(`These pages changed while Git sync was running: ${paths.join(', ')}. Nothing was applied.`);
    this.name = 'GitApplyConflictError';
  }
}

type Scope = { projectId: string; branchId: string; languageId: string };

/** A slug no sibling (page or group) in the same branch/language uses yet. */
const uniqueSiblingSlug = async (tx: Prisma.TransactionClient, scope: Scope, parentId: string | null, desired: string, fallback: string) => {
  const base = slugifyUnicode(desired) || fallback;
  for (let suffix = 1; ; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    const clash = await tx.page.findFirst({ where: { ...scope, parentId, slug }, select: { id: true } });
    if (!clash) return slug;
  }
};

const nextPosition = async (tx: Prisma.TransactionClient, scope: Scope, parentId: string | null) => {
  const max = await tx.page.aggregate({ where: { ...scope, parentId }, _max: { position: true } });
  return (max._max.position ?? -1) + 1;
};

/** Find-or-create a folder group. Matches by slug, then by title (oldest
 * first), the same rule the importers use, so earlier syncs' groups — including
 * ones created before slugs kept Arabic letters — are reused. */
const ensureGroup = async (
  tx: Prisma.TransactionClient,
  scope: Scope,
  parent: { id: string | null; path: string | null },
  segment: string,
): Promise<{ id: string; path: string }> => {
  const title = humanize(segment);
  const slug = slugifyUnicode(segment) || 'group';
  const where = { ...scope, parentId: parent.id, kind: 'GROUP' as const };
  const existing =
    (await tx.page.findFirst({ where: { ...where, slug }, select: { id: true, path: true } })) ??
    (await tx.page.findFirst({ where: { ...where, title }, orderBy: { createdAt: 'asc' }, select: { id: true, path: true } }));
  if (existing) return existing;
  const uniqueSlug = await uniqueSiblingSlug(tx, scope, parent.id, slug, 'group');
  return tx.page.create({
    data: {
      ...scope,
      parentId: parent.id,
      kind: 'GROUP',
      title,
      slug: uniqueSlug,
      path: joinPath(parent.path, uniqueSlug),
      content: '',
      position: await nextPosition(tx, scope, parent.id),
    },
    select: { id: true, path: true },
  });
};

/** Create a page for a repository file Nibleaf has no page for yet. A new
 * file always gets a NEW page with a sibling-unique slug: it never adopts an
 * existing page by slug, so two files whose names normalize alike (or two
 * Arabic names, which used to collapse to `page`) cannot overwrite each other. */
const createPageForFile = async (tx: Prisma.TransactionClient, context: GitApplyContext, path: string, raw: string): Promise<string> => {
  const { branch, language } = context;
  // Repository layout v2: the default language/version lives at the content
  // root, other languages under `<lang>/`, other versions under `versions/<slug>/`.
  const location = themeContentLocation(path, context.snapshot, context.contentPath);
  if (!location || location.versionId !== branch.id || location.languageCode !== language.code) {
    throw new Error(
      `Git sync stopped and changed nothing: ${path} is outside the ${branch.name}/${language.code} content folder this connection syncs. Move or remove the file, or change the connection's language and version.`,
    );
  }
  const scope: Scope = { projectId: context.projectId, branchId: branch.id, languageId: language.id };
  const segments = location.relative.split('/').filter(Boolean);
  const fileName = segments.pop() ?? 'index';
  const isIndex = /^(index|readme)$/i.test(fileName);
  const leafName = isIndex ? (segments.pop() ?? 'index') : fileName;
  let parent: { id: string | null; path: string | null } = { id: null, path: null };
  for (const segment of segments) parent = await ensureGroup(tx, scope, parent, segment);
  const parsed = parseFrontmatter(raw);
  const slug = await uniqueSiblingSlug(tx, scope, parent.id, leafName, 'page');
  const created = await tx.page.create({
    data: {
      ...scope,
      parentId: parent.id,
      kind: 'PAGE',
      title: deriveTitle(parsed.meta, parsed.body, leafName),
      slug,
      path: joinPath(parent.path, slug),
      content: parsed.body,
      description: parsed.meta.description?.slice(0, 500) ?? null,
      icon: parsed.meta.icon?.slice(0, 64) ?? null,
      position: await nextPosition(tx, scope, parent.id),
    },
    select: { id: true },
  });
  return created.id;
};

const pageData = (raw: string) => {
  const parsed = parseFrontmatter(raw);
  return {
    content: parsed.body,
    ...(parsed.meta.title ? { title: parsed.meta.title.slice(0, 200) } : {}),
    description: parsed.meta.description?.slice(0, 500) ?? null,
    icon: parsed.meta.icon?.slice(0, 64) ?? null,
  };
};

/**
 * Apply every change, or throw. Returns the page id each changed path now maps
 * to (null after a deletion). Revision misses are collected across all changes
 * and raised together, so one retry surfaces every concurrently edited page.
 */
export const applyGitContentChanges = async (
  tx: Prisma.TransactionClient,
  context: GitApplyContext,
  changes: GitContentChange[],
): Promise<Map<string, string | null>> => {
  const { projectId } = context;
  const pageIds = new Map<string, string | null>();
  const conflicts: string[] = [];
  // Creating pages allocates sibling slugs; take the project row lock that
  // createPage and structural page updates take, and take it first, so this
  // transaction locks in the same order they do.
  if (changes.some((change) => change.type === 'write' && (change.pageId === null || change.observedUpdatedAt === null))) {
    await tx.$queryRaw`SELECT "id" FROM "project" WHERE "id" = ${projectId} FOR UPDATE`;
  }
  for (const change of changes) {
    if (change.type === 'delete') {
      if (change.observedUpdatedAt === null) {
        await tx.page.deleteMany({ where: { id: change.pageId, projectId, kind: 'PAGE' } });
      } else {
        const deleted = await tx.page.deleteMany({ where: { id: change.pageId, projectId, kind: 'PAGE', updatedAt: change.observedUpdatedAt } });
        // Already gone is the outcome the deletion wanted; still present means
        // someone saved it after the merge read.
        if (deleted.count === 0 && (await tx.page.findFirst({ where: { id: change.pageId, projectId }, select: { id: true } }))) {
          conflicts.push(change.path);
        }
      }
      pageIds.set(change.path, null);
      continue;
    }
    if (change.pageId && change.observedUpdatedAt !== null) {
      const updated = await tx.page.updateMany({
        where: { id: change.pageId, projectId, updatedAt: change.observedUpdatedAt },
        data: pageData(change.content),
      });
      // A miss means the page was saved or deleted after the merge read it.
      if (updated.count === 0) conflicts.push(change.path);
      pageIds.set(change.path, change.pageId);
      continue;
    }
    if (change.pageId && (await tx.page.findFirst({ where: { id: change.pageId, projectId }, select: { id: true } }))) {
      // A ledger-linked page the merge did not read (it is outside the current
      // export map): keep the long-standing update-by-id behavior.
      await tx.page.update({ where: { id: change.pageId }, data: pageData(change.content) });
      pageIds.set(change.path, change.pageId);
      continue;
    }
    pageIds.set(change.path, await createPageForFile(tx, context, change.path, change.content));
  }
  if (conflicts.length > 0) throw new GitApplyConflictError(conflicts);
  return pageIds;
};
