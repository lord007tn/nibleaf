import { prisma } from '@nibleaf/database';
import { getDefaultBranch } from '../branches';
import { getDefaultLanguage } from '../languages';
import { createPage } from '../pages';

/**
 * Idempotent page-upsert machinery shared by every importer (Git, Mintlify,
 * Ghost, …). Pages are matched by (branch, language, parent, slug) so
 * re-importing updates in place instead of duplicating.
 */

export interface ImportTarget {
  projectId: string;
  branchId: string;
  languageId: string;
}

/** The project's default branch + language — where importers without an explicit target write. */
export const defaultImportTarget = async (projectId: string): Promise<ImportTarget> => {
  const [branch, language] = await Promise.all([getDefaultBranch(projectId), getDefaultLanguage(projectId)]);
  return { projectId, branchId: branch.id, languageId: language.id };
};

/**
 * Find-or-create a GROUP page under `parentId`. When the group already exists
 * and a `position` is given, the position is refreshed so re-imports keep the
 * source ordering; otherwise the existing group is left untouched.
 *
 * The exact slug match is authoritative; only when no sibling group carries the
 * slug do we fall back to a title match (needed because, when the desired slug
 * is taken by a non-group sibling, creation suffixes the slug — `guides-2` —
 * and the title is then what keeps re-imports finding that same group). The
 * title fallback is ordered by createdAt so repeated imports deterministically
 * pick the same (oldest) group instead of a nondeterministic row.
 */
export const ensureGroupPage = async (
  target: ImportTarget,
  group: { parentId: string | null; title: string; slug: string; icon?: string; position?: number },
): Promise<string> => {
  const { projectId, branchId, languageId } = target;
  const scope = { projectId, branchId, languageId, parentId: group.parentId, kind: 'GROUP' as const };
  const existing =
    (await prisma.page.findFirst({ where: { ...scope, slug: group.slug }, select: { id: true } })) ??
    (await prisma.page.findFirst({ where: { ...scope, title: group.title }, orderBy: { createdAt: 'asc' }, select: { id: true } }));
  if (existing) {
    if (group.position !== undefined) {
      await prisma.page.update({ where: { id: existing.id }, data: { position: group.position } });
    }
    return existing.id;
  }
  const created = await createPage(projectId, {
    title: group.title,
    slug: group.slug,
    kind: 'GROUP',
    parentId: group.parentId,
    languageId,
    branchId,
    ...(group.icon !== undefined ? { icon: group.icon } : {}),
    ...(group.position !== undefined ? { position: group.position } : {}),
  });
  return created.id;
};

export type UpsertOutcome = 'imported' | 'updated';

/**
 * Upsert one leaf page by (parent, slug). Optional fields are only written when
 * provided, so callers that omit them (e.g. the Git import) keep the stored values.
 */
export const upsertLeafPage = async (
  target: ImportTarget,
  page: { parentId: string | null; slug: string; title: string; content: string; description?: string; icon?: string; position?: number },
): Promise<UpsertOutcome> => {
  const { projectId, branchId, languageId } = target;
  // Scoped to kind PAGE so a leaf import can never overwrite a sibling GROUP
  // row that happens to carry the same slug — the create path below (via
  // uniqueSiblingSlug in createPage) suffixes the slug instead.
  const found = await prisma.page.findFirst({
    where: { projectId, branchId, languageId, parentId: page.parentId, slug: page.slug, kind: 'PAGE' },
    select: { id: true },
  });
  if (found) {
    await prisma.page.update({
      where: { id: found.id },
      data: {
        title: page.title,
        content: page.content,
        ...(page.description !== undefined ? { description: page.description } : {}),
        ...(page.icon !== undefined ? { icon: page.icon } : {}),
        ...(page.position !== undefined ? { position: page.position } : {}),
      },
    });
    return 'updated';
  }
  await createPage(projectId, {
    title: page.title,
    slug: page.slug,
    content: page.content,
    parentId: page.parentId,
    languageId,
    branchId,
    ...(page.description !== undefined ? { description: page.description } : {}),
    ...(page.icon !== undefined ? { icon: page.icon } : {}),
    ...(page.position !== undefined ? { position: page.position } : {}),
  });
  return 'imported';
};
