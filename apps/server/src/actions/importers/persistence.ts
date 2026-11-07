import { STARTER_GETTING_STARTED_CONTENT } from '@nibleaf/auth/starter-content';
import { prisma } from '@nibleaf/database';
import { type PageConfig, pageConfigSchema } from '@nibleaf/validators';
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

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();
const PRISTINE_GETTING_STARTED = normalizeWhitespace(STARTER_GETTING_STARTED_CONTENT);

/** Whether a root starter page is exactly as Nibleaf created it: the sign-up
 * Getting started page with its template text, or a blank Welcome page.
 * Whitespace differences are ignored; any other edit makes it the writer's. */
export const isPristineStarterPage = (page: { slug: string; content: string }): boolean => {
  const content = normalizeWhitespace(page.content);
  if (page.slug === 'getting-started') return content === PRISTINE_GETTING_STARTED;
  return page.slug === 'welcome' && content === '';
};

/** Remove only untouched starter pages before a real import, so the promise
 * that nothing a writer edited is deleted holds: a page counts only while its
 * text is still the template's and nothing was added under it (deleting it
 * would cascade to those pages). */
export const removeImportPlaceholders = async (target: ImportTarget): Promise<number> => {
  const rows = await prisma.page.findMany({
    where: {
      projectId: target.projectId,
      branchId: target.branchId,
      languageId: target.languageId,
      parentId: null,
      kind: 'PAGE',
      slug: { in: ['welcome', 'getting-started'] },
    },
    select: { id: true, slug: true, content: true },
  });
  const pristine = rows.filter(isPristineStarterPage).map((page) => page.id);
  if (pristine.length === 0) return 0;
  const parents = new Set(
    (await prisma.page.findMany({ where: { parentId: { in: pristine } }, select: { parentId: true } })).map((child) => child.parentId),
  );
  const ids = pristine.filter((id) => !parents.has(id));
  if (ids.length === 0) return 0;
  const result = await prisma.page.deleteMany({ where: { id: { in: ids } } });
  return result.count;
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

export interface ImportedPage {
  parentId: string | null;
  slug: string;
  title: string;
  content: string;
  description?: string;
  icon?: string;
  config?: PageConfig;
  translationKey?: string;
  position?: number;
  hidden?: boolean;
}

/**
 * Upsert one leaf page by (parent, slug). Optional fields are only written when
 * provided, so callers that omit them (e.g. the Git import) keep the stored values.
 */
export const upsertLeafPage = async (target: ImportTarget, page: ImportedPage): Promise<UpsertOutcome> => (await upsertPage(target, page)).outcome;

/** {@link upsertLeafPage} that also returns the row id, for importers whose
 * pages have child pages of their own (GitBook nests pages under pages). */
export const upsertPage = async (target: ImportTarget, page: ImportedPage): Promise<{ outcome: UpsertOutcome; id: string }> => {
  const { projectId, branchId, languageId } = target;
  // Scoped to kind PAGE so a leaf import can never overwrite a sibling GROUP
  // row that happens to carry the same slug — the create path below (via
  // uniqueSiblingSlug in createPage) suffixes the slug instead.
  const found = await prisma.page.findFirst({
    where: { projectId, branchId, languageId, parentId: page.parentId, slug: page.slug, kind: 'PAGE' },
    select: { id: true, config: true },
  });
  if (found) {
    const parsedConfig = pageConfigSchema.safeParse(found.config);
    const existingConfig: PageConfig = parsedConfig.success ? parsedConfig.data : {};
    await prisma.page.update({
      where: { id: found.id },
      data: {
        title: page.title,
        content: page.content,
        ...(page.description !== undefined ? { description: page.description } : {}),
        ...(page.icon !== undefined ? { icon: page.icon } : {}),
        ...(page.config !== undefined ? { config: { ...existingConfig, ...page.config } } : {}),
        ...(page.translationKey !== undefined ? { translationKey: page.translationKey } : {}),
        ...(page.position !== undefined ? { position: page.position } : {}),
        ...(page.hidden !== undefined ? { hidden: page.hidden } : {}),
      },
    });
    return { outcome: 'updated', id: found.id };
  }
  const created = await createPage(projectId, {
    title: page.title,
    slug: page.slug,
    content: page.content,
    parentId: page.parentId,
    languageId,
    branchId,
    ...(page.description !== undefined ? { description: page.description } : {}),
    ...(page.icon !== undefined ? { icon: page.icon } : {}),
    ...(page.config !== undefined ? { config: page.config } : {}),
    ...(page.translationKey !== undefined ? { translationKey: page.translationKey } : {}),
    ...(page.position !== undefined ? { position: page.position } : {}),
  });
  // createPage has no visibility input; hidden pages are flagged right after.
  if (page.hidden) await prisma.page.update({ where: { id: created.id }, data: { hidden: true } });
  return { outcome: 'imported', id: created.id };
};
