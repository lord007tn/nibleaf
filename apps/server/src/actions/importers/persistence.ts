import { STARTER_GETTING_STARTED_CONTENT, STARTER_GETTING_STARTED_ICON, STARTER_GETTING_STARTED_TITLE } from '@nibleaf/auth/starter-content';
import { Prisma, prisma } from '@nibleaf/database';
import { importedPageIcon } from '@nibleaf/shared/page-icons';
import { exceedsUtf8Bytes, MAX_PAGE_CONTENT_BYTES } from '@nibleaf/shared/page-limits';
import { type PageConfig, pageConfigSchema } from '@nibleaf/validators';
import { getDefaultBranch } from '../branches';
import { getDefaultLanguage } from '../languages';
import { assertPageContentFits, createPage } from '../pages';
import { CLEANUP_TRANSACTION, isCleanupLockTimeout, limitCleanupLockWait } from './cleanup-locks';

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

const starterFields = {
  id: true,
  slug: true,
  title: true,
  icon: true,
  description: true,
  hidden: true,
  config: true,
  translationKey: true,
  content: true,
} as const;

type StarterCandidate = {
  slug: string;
  title: string;
  icon: string | null;
  description: string | null;
  hidden: boolean;
  config: unknown;
  translationKey: string | null;
  content: string;
};

/** Whether a root starter page is exactly as Nibleaf created it: every field
 * sign-up sets (title, icon, text) still matches, and every field it leaves
 * empty (description, settings, translation key, hidden) still is. Only the
 * sign-up Getting started page qualifies: no sign-up flow created a blank
 * Welcome or coming-soon page; the other sample pages are left in place on
 * purpose. Whitespace differences in the text are ignored; any other edit — a
 * rename included — makes the page the writer's. */
export const isPristineStarterPage = (page: StarterCandidate): boolean => {
  const untouchedSettings = page.description === null && !page.hidden && page.config === null && page.translationKey === null;
  if (!untouchedSettings) return false;
  return (
    page.slug === 'getting-started' &&
    page.title === STARTER_GETTING_STARTED_TITLE &&
    page.icon === STARTER_GETTING_STARTED_ICON &&
    normalizeWhitespace(page.content) === PRISTINE_GETTING_STARTED
  );
};

/**
 * Remove only untouched starter pages before a real import, so the promise
 * that nothing a writer edited is deleted holds.
 *
 * An unlocked read only finds candidates. The deletion then runs in one
 * transaction under the page-write lock protocol: project row first
 * (`FOR NO KEY UPDATE`, which also holds off new child pages), then the
 * candidate rows `FOR UPDATE` in ascending id order, which waits for any
 * autosave in flight. Each candidate is re-read and re-checked there —
 * signature, and no child pages, comments or audience grants (all would go
 * with it) — and only rows that still qualify go.
 */
export const removeImportPlaceholders = async (target: ImportTarget): Promise<number> => {
  const scope = { projectId: target.projectId, branchId: target.branchId, languageId: target.languageId, parentId: null, kind: 'PAGE' as const };
  const where = { ...scope, slug: 'getting-started' };
  const candidates = (await prisma.page.findMany({ where, select: starterFields })).filter(isPristineStarterPage).map((page) => page.id);
  if (candidates.length === 0) return 0;
  const ids = [...candidates].sort();
  try {
    return await prisma.$transaction(async (tx) => {
      await limitCleanupLockWait(tx);
      await tx.$queryRaw`SELECT 1 FROM "project" WHERE "id" = ${target.projectId} FOR NO KEY UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "page" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
      // Comments and audience grants cascade with their page: a page that
      // gathered either is no longer just the starter.
      const pristine = (
        await tx.page.findMany({ where: { ...where, id: { in: ids }, comments: { none: {} }, audienceGrants: { none: {} } }, select: starterFields })
      )
        .filter(isPristineStarterPage)
        .map((page) => page.id);
      if (pristine.length === 0) return 0;
      const parents = new Set(
        (await tx.page.findMany({ where: { parentId: { in: pristine } }, select: { parentId: true } })).map((child) => child.parentId),
      );
      const deletable = pristine.filter((id) => !parents.has(id));
      if (deletable.length === 0) return 0;
      return (await tx.page.deleteMany({ where: { id: { in: deletable } } })).count;
    }, CLEANUP_TRANSACTION);
  } catch (error) {
    // A lock stayed busy for 10 s (a long Git sync holds the project lock):
    // keep the starter page rather than fail the import.
    if (isCleanupLockTimeout(error)) return 0;
    throw error;
  }
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
    // Only icons the reader draws; an unknown one is dropped, never an import failure.
    ...(group.icon !== undefined ? { icon: importedPageIcon(group.icon) } : {}),
    ...(group.position !== undefined ? { position: group.position } : {}),
  });
  return created.id;
};

export type UpsertOutcome = 'imported' | 'updated';

/** An imported config with its category icon kept only when the reader draws
 *  it (or the page already had it). */
const withImportedCategoryIcon = (config: PageConfig, existing?: string): PageConfig => {
  if (config.categoryIcon === undefined) return config;
  const { categoryIcon, ...rest } = config;
  const kept = importedPageIcon(categoryIcon, existing);
  return kept ? { ...rest, categoryIcon: kept } : rest;
};

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
export const upsertPage = async (target: ImportTarget, page: ImportedPage): Promise<{ outcome: UpsertOutcome; id: string }> =>
  persistPage(target, page);

/** Reserve addresses without replacing an existing body until all destinations are known. */
export const reserveImportPage = async (target: ImportTarget, page: Omit<ImportedPage, 'content'>) => persistPage(target, page);

const persistPage = async (
  target: ImportTarget,
  page: Omit<ImportedPage, 'content'> & { content?: string },
): Promise<{ outcome: UpsertOutcome; id: string }> => {
  const { projectId, branchId, languageId } = target;
  // Scoped to kind PAGE so a leaf import can never overwrite a sibling GROUP
  // row that happens to carry the same slug — the create path below (via
  // uniqueSiblingSlug in createPage) suffixes the slug instead.
  const found = await prisma.page.findFirst({
    where: { projectId, branchId, languageId, parentId: page.parentId, slug: page.slug, kind: 'PAGE' },
    select: { id: true, config: true, icon: true },
  });
  if (found) {
    const parsedConfig = pageConfigSchema.safeParse(found.config);
    const existingConfig: PageConfig = parsedConfig.success ? parsedConfig.data : {};
    const config = page.config && withImportedCategoryIcon(page.config, existingConfig.categoryIcon);
    const data = {
      title: page.title,
      ...(page.content !== undefined ? { content: page.content } : {}),
      ...(page.description !== undefined ? { description: page.description } : {}),
      // Only icons the reader draws (or the one the page already had); others are dropped.
      ...(page.icon !== undefined ? { icon: importedPageIcon(page.icon, found.icon) } : {}),
      ...(config !== undefined ? { config: { ...existingConfig, ...config } } : {}),
      ...(page.translationKey !== undefined ? { translationKey: page.translationKey } : {}),
      ...(page.position !== undefined ? { position: page.position } : {}),
      ...(page.hidden !== undefined ? { hidden: page.hidden } : {}),
    };
    await updateImportPage(target, found.id, data, page.content);
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
    ...(page.icon !== undefined ? { icon: importedPageIcon(page.icon) } : {}),
    ...(page.config !== undefined ? { config: withImportedCategoryIcon(page.config) } : {}),
    ...(page.translationKey !== undefined ? { translationKey: page.translationKey } : {}),
    ...(page.position !== undefined ? { position: page.position } : {}),
  });
  // createPage has no visibility input; hidden pages are flagged right after.
  if (page.hidden) await prisma.page.update({ where: { id: created.id }, data: { hidden: true } });
  return { outcome: 'imported', id: created.id };
};

/** Content writes keep the editor's size rule, including legacy oversized pages. */
export const writeImportPageContent = async (target: ImportTarget, id: string, content: string): Promise<void> => {
  await updateImportPage(target, id, { content }, content);
};

const updateImportPage = async (target: ImportTarget, id: string, data: Prisma.PageUpdateInput, content?: string) => {
  const where = { id, projectId: target.projectId, branchId: target.branchId, languageId: target.languageId };
  if (content === undefined || !exceedsUtf8Bytes(content, MAX_PAGE_CONTENT_BYTES)) {
    await prisma.page.update({ where, data });
    return;
  }
  await prisma.$transaction(async (tx) => {
    const [stored] = await tx.$queryRaw<Array<{ content: string }>>`
      SELECT content FROM "page" WHERE id = ${id} AND "projectId" = ${target.projectId}
      AND "branchId" = ${target.branchId} AND "languageId" = ${target.languageId} FOR NO KEY UPDATE`;
    assertPageContentFits(content, stored?.content);
    await tx.page.update({ where, data });
  });
};
