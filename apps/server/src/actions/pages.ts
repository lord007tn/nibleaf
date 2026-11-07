import { Prisma, prisma } from '@nibleaf/database';
import { INTERFACE_LOCALES } from '@nibleaf/i18n/locales';
import { editor_newgroup, editor_untitled } from '@nibleaf/i18n/messages';
import { joinPath, slugifyUnicode } from '@nibleaf/shared/utils';
import type { CreatePageBody, ReorderPagesBody, UpdatePageBody } from '@nibleaf/validators';
import { badRequest, conflict, notFound } from '@/errors';
import { assertBranchInProject, getDefaultBranch } from './branches';
import { assertLanguageInProject, getDefaultLanguage } from './languages';
import { logFirstContentEdit } from './platform-events';

/** Flat list of a project's pages on one branch (the default branch when none is
 *  given), ordered for tree assembly on the client. Scoped to a single language
 *  when `languageId` is given. */
export const listPages = async (projectId: string, languageId?: string, branchId?: string) => {
  const resolvedBranchId = branchId ? (await assertBranchInProject(projectId, branchId)).id : (await getDefaultBranch(projectId)).id;
  if (languageId) {
    await assertLanguageInProject(projectId, languageId);
  }
  return prisma.page.findMany({
    where: { projectId, branchId: resolvedBranchId, ...(languageId ? { languageId } : {}) },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      parentId: true,
      branchId: true,
      languageId: true,
      kind: true,
      title: true,
      slug: true,
      path: true,
      icon: true,
      description: true,
      config: true,
      translationKey: true,
      position: true,
      hidden: true,
      updatedAt: true,
    },
  });
};

export const getPage = async (projectId: string, id: string) => {
  const page = await prisma.page.findFirst({ where: { id, projectId } });
  if (!page) {
    throw notFound('page', { id });
  }
  return page;
};

/** A unique slug among a parent's children within one language, deriving from the
 *  title when absent. Scoped to (projectId, languageId, parentId) so two languages
 *  can each have e.g. `/introduction`. */
const uniqueSiblingSlug = async (
  db: Prisma.TransactionClient,
  projectId: string,
  languageId: string,
  branchId: string,
  parentId: string | null,
  desired: string,
  excludeId?: string,
): Promise<string> => {
  // Unicode-aware so an Arabic (or any non-Latin) title keeps its own slug; the
  // 'page' placeholder is only reached when the title has no letters or digits
  // at all (emoji-only, punctuation-only).
  const base = slugifyUnicode(desired) || 'page';
  let slug = base;
  let suffix = 1;
  for (;;) {
    const clash = await db.page.findFirst({
      where: { projectId, languageId, branchId, parentId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) {
      return slug;
    }
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
};

const PLACEHOLDER_SLUG_RE = /^(?:untitled|new-group)(?:-\d+)?$/;
/** The dashboard creates pages/groups with a placeholder title in the author's
 *  interface locale (`editor.untitled` / `editor.newGroup`), so "still a
 *  placeholder" must be recognised in every locale, not only English. */
const PLACEHOLDER_TITLES = new Set<string>(
  INTERFACE_LOCALES.flatMap(({ code }) => [editor_untitled(undefined, { locale: code }), editor_newgroup(undefined, { locale: code })]),
);

type PageTreeNode = { id: string; parentId: string | null; branchId: string; languageId: string };

/** Resolve a parent's path, language, and branch. A child inherits both its
 *  parent's language and branch. */
const parentInfo = async (
  db: Prisma.TransactionClient,
  projectId: string,
  parentId: string | null,
): Promise<{ path: string | null; languageId: string | null; branchId: string | null }> => {
  if (!parentId) {
    return { path: null, languageId: null, branchId: null };
  }
  const parent = await db.page.findFirst({ where: { id: parentId, projectId }, select: { path: true, languageId: true, branchId: true } });
  if (!parent) {
    throw notFound('page', { id: parentId });
  }
  return { path: parent.path, languageId: parent.languageId, branchId: parent.branchId };
};

const assertNoParentCycle = (pages: Map<string, PageTreeNode>, id: string, parentId: string | null): void => {
  let current = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === id) {
      throw badRequest('A page cannot be moved under itself or one of its descendants.', { id, parentId });
    }
    if (seen.has(current)) {
      throw badRequest('The page tree contains a parent cycle.', { id, parentId: current });
    }
    seen.add(current);
    current = pages.get(current)?.parentId ?? null;
  }
};

/** Recompute materialized paths in the same transaction as the tree change. */
const recomputeProjectPaths = async (projectId: string, tx: Prisma.TransactionClient): Promise<void> => {
  const pages = await tx.page.findMany({ where: { projectId }, select: { id: true, parentId: true, slug: true, path: true } });
  const byId = new Map(pages.map((p) => [p.id, p]));
  const pathOf = (id: string, seen = new Set<string>()): string => {
    if (seen.has(id)) {
      return '';
    }
    seen.add(id);
    const node = byId.get(id);
    if (!node) {
      return '';
    }
    return node.parentId ? joinPath(pathOf(node.parentId, seen), node.slug) : node.slug;
  };
  const updates = pages.map((p) => ({ id: p.id, path: pathOf(p.id), old: p.path })).filter((u) => u.path !== u.old);
  for (const u of updates) await tx.page.update({ where: { id: u.id }, data: { path: u.path } });
};

/** A move or slug change rewrites the paths of the page and its subtree. */
const STRUCTURAL_UPDATE_TIMEOUT_MS = 30_000;

export const createPage = async (projectId: string, body: CreatePageBody, userId?: string) => {
  const page = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "project" WHERE id = ${projectId} FOR NO KEY UPDATE`;
      const parentId = body.parentId ?? null;
      const parent = await parentInfo(tx, projectId, parentId);
      // A child inherits its parent's branch + language; otherwise use the requested
      // ones or the project's required defaults.
      const branchId =
        parent.branchId ??
        (body.branchId ? (await assertBranchInProject(projectId, body.branchId, tx)).id : (await getDefaultBranch(projectId, tx)).id);
      const languageId =
        parent.languageId ??
        (body.languageId ? (await assertLanguageInProject(projectId, body.languageId, tx)).id : (await getDefaultLanguage(projectId, tx)).id);
      const slug = await uniqueSiblingSlug(tx, projectId, languageId, branchId, parentId, body.slug || body.title);
      const maxPosition = await tx.page.aggregate({ where: { projectId, branchId, languageId, parentId }, _max: { position: true } });
      return tx.page.create({
        data: {
          projectId,
          branchId,
          languageId,
          parentId,
          kind: body.kind ?? 'PAGE',
          title: body.title,
          slug,
          path: joinPath(parent.path, slug),
          icon: body.icon ?? null,
          description: body.description ?? null,
          content: body.content ?? '',
          config: body.config ?? undefined,
          translationKey: body.translationKey ?? null,
          position: body.position ?? (maxPosition._max.position ?? -1) + 1,
        },
      });
    },
    { timeout: STRUCTURAL_UPDATE_TIMEOUT_MS },
  );
  if (userId && page.kind === 'PAGE' && page.content.trim()) logFirstContentEdit(userId, projectId);
  return page;
};

/** Deep-merge a page-config patch over the stored config: the `seo` object is
 *  merged key-by-key; scalar keys (sidebarTitle/mode/hideToc) replace. Passing
 *  `null` clears the whole config. Mirrors updateProject's section-level merge. */
const mergePageConfig = (existing: unknown, patch: UpdatePageBody['config']): object | null | undefined => {
  if (patch === undefined) {
    return undefined; // not touched
  }
  if (patch === null) {
    return null; // explicit clear
  }
  const base = (existing ?? {}) as Record<string, unknown>;
  const baseSeo = (base.seo ?? {}) as Record<string, unknown>;
  return { ...base, ...patch, ...(patch.seo ? { seo: { ...baseSeo, ...patch.seo } } : {}) };
};

/** Raised when an `expectedUpdatedAt` precondition no longer matches the page. */
const pageRevisionConflict = (id: string) =>
  conflict('This page was changed after it was read. Re-read it and apply the edit again.', { id, reason: 'revision_conflict' });

const isRecordNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2025';

interface UpdatePageOptions {
  /** Optimistic-concurrency precondition: apply the update only while the page's
   *  `updatedAt` still equals this value. The final write is conditional on it,
   *  so an edit that lands between the read and the write is never overwritten. */
  expectedUpdatedAt?: Date;
}

const pageRouteEdit = (page: { title: string; slug: string; parentId: string | null }, body: UpdatePageBody) => {
  const adoptsTitle =
    body.slug === undefined &&
    body.title !== undefined &&
    body.title.trim() !== '' &&
    body.title !== page.title &&
    PLACEHOLDER_SLUG_RE.test(page.slug) &&
    PLACEHOLDER_TITLES.has(page.title);
  const desired = body.slug || (adoptsTitle ? body.title : page.slug) || page.slug;
  const parentId = body.parentId === undefined ? page.parentId : body.parentId;
  return {
    parentId,
    desiredSlug: desired,
    structural: parentId !== page.parentId || (desired !== page.slug && (slugifyUnicode(desired) || 'page') !== page.slug),
  };
};

// Reclassify if the page changed while waiting for its row lock; release that
// lock before retrying in project -> page order.
class StructuralPageEdit extends Error {}

export const updatePage = async (projectId: string, id: string, body: UpdatePageBody, userId?: string, options?: UpdatePageOptions) => {
  const initial = await getPage(projectId, id);
  const save = (lockStructure: boolean) =>
    prisma.$transaction(
      async (tx) => {
        if (lockStructure) {
          await tx.$queryRaw`SELECT 1 FROM "project" WHERE id = ${projectId} FOR NO KEY UPDATE`;
          await tx.$queryRaw`SELECT 1 FROM "page" WHERE "projectId" = ${projectId} ORDER BY id FOR NO KEY UPDATE`;
        } else {
          await tx.$queryRaw`SELECT 1 FROM "page" WHERE id = ${id} AND "projectId" = ${projectId} FOR NO KEY UPDATE`;
        }
        const page = await tx.page.findFirst({ where: { id, projectId } });
        if (!page) throw notFound('page', { id });
        const route = pageRouteEdit(page, body);
        if (!lockStructure && route.structural) throw new StructuralPageEdit();
        const expectedUpdatedAt = options?.expectedUpdatedAt;
        if (expectedUpdatedAt && page.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw pageRevisionConflict(id);
        }
        // The slug/URL is decoupled from the title (Mintlify-style): it only changes
        // when the slug is set explicitly or the page is re-parented (which needs a
        // uniqueness re-check among the new siblings). A title-only edit — e.g. every
        // editor autosave keystroke — must NOT silently rewrite the slug/path.
        const nextParentId = route.parentId;
        if (nextParentId !== null && nextParentId !== page.parentId) {
          const parent = await parentInfo(tx, projectId, nextParentId);
          if (parent.branchId !== page.branchId || parent.languageId !== page.languageId) {
            throw badRequest('A page can only be moved under a parent in the same branch and language.', { id, parentId: nextParentId });
          }
          const pages = await tx.page.findMany({ where: { projectId }, select: { id: true, parentId: true, branchId: true, languageId: true } });
          assertNoParentCycle(new Map(pages.map((node) => [node.id, node])), id, nextParentId);
        }
        const structural = route.structural;
        const nextSlug = structural
          ? await uniqueSiblingSlug(tx, projectId, page.languageId, page.branchId, nextParentId, route.desiredSlug, id)
          : page.slug;
        const nextConfig = mergePageConfig(page.config, body.config);
        const updated = await tx.page
          .update({
            // With a precondition the write matches only the revision that was read;
            // a concurrent edit makes it match nothing (P2025) instead of being lost.
            where: expectedUpdatedAt ? { id, updatedAt: expectedUpdatedAt } : { id },
            data: {
              ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
              ...(body.title === undefined ? {} : { title: body.title }),
              ...(structural ? { slug: nextSlug } : {}),
              ...(body.icon === undefined ? {} : { icon: body.icon }),
              ...(body.description === undefined ? {} : { description: body.description }),
              ...(body.content === undefined ? {} : { content: body.content }),
              ...(body.hidden === undefined ? {} : { hidden: body.hidden }),
              ...(body.translationKey === undefined ? {} : { translationKey: body.translationKey }),
              ...(nextConfig === undefined ? {} : { config: nextConfig ?? Prisma.JsonNull }),
            },
          })
          .catch((error: unknown) => {
            throw expectedUpdatedAt && isRecordNotFound(error) ? pageRevisionConflict(id) : error;
          });
        // A structural change commits with the path recomputation, so a failure
        // never leaves the page or its descendants with stale paths.
        if (structural) await recomputeProjectPaths(projectId, tx);
        return { page, updated: structural ? await tx.page.findFirstOrThrow({ where: { id, projectId } }) : updated };
      },
      { timeout: STRUCTURAL_UPDATE_TIMEOUT_MS },
    );
  let result: Awaited<ReturnType<typeof save>>;
  try {
    result = await save(pageRouteEdit(initial, body).structural);
  } catch (error) {
    if (!(error instanceof StructuralPageEdit)) throw error;
    result = await save(true);
  }
  const { page, updated } = result;
  if (userId && page.kind === 'PAGE' && body.content !== undefined && body.content.trim() !== page.content.trim()) {
    logFirstContentEdit(userId, projectId);
  }
  return updated;
};

export const deletePage = async (projectId: string, id: string) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "project" WHERE id = ${projectId} FOR NO KEY UPDATE`;
    await tx.$queryRaw`SELECT 1 FROM "page" WHERE "projectId" = ${projectId} ORDER BY id FOR NO KEY UPDATE`;
    const page = await tx.page.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!page) throw notFound('page', { id });
    await tx.page.delete({ where: { id } });
    return { id };
  });

export const reorderPages = async (projectId: string, body: ReorderPagesBody) => {
  const branchId = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "project" WHERE id = ${projectId} FOR NO KEY UPDATE`;
      await tx.$queryRaw`SELECT 1 FROM "page" WHERE "projectId" = ${projectId} ORDER BY id FOR NO KEY UPDATE`;
      const pages = await tx.page.findMany({
        where: { projectId },
        select: { id: true, parentId: true, branchId: true, languageId: true, slug: true },
      });
      const byPage = new Map(pages.map((page) => [page.id, page]));
      const proposed = new Map<string, string | null>();
      for (const item of body.items) {
        if (proposed.has(item.id)) {
          throw badRequest('Each page can only appear once in a reorder request.', { id: item.id });
        }
        const page = byPage.get(item.id);
        if (!page) {
          throw notFound('page', { id: item.id });
        }
        proposed.set(item.id, item.parentId);
        if (!item.parentId) {
          continue;
        }
        const parent = byPage.get(item.parentId);
        if (!parent) {
          throw notFound('page', { id: item.parentId });
        }
        if (parent.branchId !== page.branchId || parent.languageId !== page.languageId) {
          throw badRequest('Pages can only be reordered under parents in the same branch and language.', { id: item.id, parentId: item.parentId });
        }
      }
      const nextTree = new Map(
        pages.map((page) => [page.id, { ...page, parentId: proposed.has(page.id) ? (proposed.get(page.id) ?? null) : page.parentId }]),
      );
      for (const item of body.items) {
        assertNoParentCycle(nextTree, item.id, item.parentId);
      }
      for (const item of body.items) {
        const page = nextTree.get(item.id);
        if (!page || byPage.get(item.id)?.parentId === item.parentId) continue;
        const clash = [...nextTree.values()].find(
          (sibling) =>
            sibling.id !== page.id &&
            sibling.branchId === page.branchId &&
            sibling.languageId === page.languageId &&
            sibling.parentId === page.parentId &&
            sibling.slug === page.slug,
        );
        if (clash) {
          throw conflict('A page with this address already exists in that group. Change its address first.', { id: page.id, reason: 'slug_taken' });
        }
      }
      for (const item of body.items) {
        await tx.page.updateMany({ where: { id: item.id, projectId }, data: { parentId: item.parentId, position: item.position } });
      }
      await recomputeProjectPaths(projectId, tx);
      return body.items[0] ? byPage.get(body.items[0].id)?.branchId : undefined;
    },
    { timeout: STRUCTURAL_UPDATE_TIMEOUT_MS },
  );
  // Return the list scoped to the branch the moved pages live on (all items share
  // a branch — they were validated against their parents above). Empty items keep
  // the default-branch behavior.
  return listPages(projectId, undefined, branchId);
};
