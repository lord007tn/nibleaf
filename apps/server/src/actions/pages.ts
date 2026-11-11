import { createHash } from 'node:crypto';
import { Prisma, prisma } from '@nibleaf/database';
import { INTERFACE_LOCALES } from '@nibleaf/i18n/locales';
import { editor_newgroup } from '@nibleaf/i18n/messages/editor_newgroup';
import { editor_untitled } from '@nibleaf/i18n/messages/editor_untitled';
import { pageDescription } from '@nibleaf/shared/markdown-text';
import { type PageStructureRow, resolvePageMove } from '@nibleaf/shared/page-moves';
import { interpolateVariablesWithin, variablesFromConfig } from '@nibleaf/shared/site';
import { joinPath, slugifyUnicode } from '@nibleaf/shared/utils';
import type { BulkReorderPagesBody, CreatePageBody, ReorderPagesBody, UpdatePageBody } from '@nibleaf/validators';
import { AppError, badRequest, conflict, notFound } from '@/errors';
import { assertAddressLinkRevisions, type PagePathChange, prepareAddressLinks, preservePageAddresses } from '@/lib/page-address-changes';
import { snapshotPage } from '@/lib/page-history';
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

/** How much of the body the generated description is built from, before and
 *  after variables. `pageDescription` reads at most the first 4 KB after the
 *  frontmatter, so 8 KB always covers it. */
export const SEARCH_DESCRIPTION_SOURCE_LIMIT = 8192;
const SEARCH_DESCRIPTION_CACHE_LIMIT = 500;
/** Keyed by page, page revision and project revision, so a hit never reads the body. */
const searchDescriptionCache = new Map<string, string>();

/** The body after a leading `---` / `+++` frontmatter block (dropped from
 *  descriptions anyway), so the bounded window starts at the prose. One
 *  forward pass; an unclosed block is kept, as `markdown-text` keeps it. */
const withoutFrontmatter = (content: string): string => {
  const fence = content.startsWith('---') ? '---' : content.startsWith('+++') ? '+++' : null;
  const firstBreak = content.indexOf('\n');
  if (!fence || firstBreak === -1 || content.slice(0, firstBreak).trim() !== fence) return content;
  for (let start = firstBreak + 1; start < content.length; ) {
    const end = content.indexOf('\n', start);
    const line = content.slice(start, end === -1 ? content.length : end);
    if (line.trim() === fence) return end === -1 ? '' : content.slice(end + 1);
    if (end === -1) break;
    start = end + 1;
  }
  return content;
};

/** The description the published site generates from the page's saved content
 *  when the author writes none (no SEO description, no summary), with the
 *  project's `{{ variables }}` resolved as a publish resolves them.
 *
 *  Author content reaches this, so its cost is bounded: only the first
 *  `SEARCH_DESCRIPTION_SOURCE_LIMIT` characters of the body are expanded, the
 *  expansion stops at that length too, and the result is cached per revision.
 *  `revision` is the page revision the text was generated from. */
export const getPageSearchDescription = async (projectId: string, id: string) => {
  const [revisionRow, project] = await Promise.all([
    prisma.page.findFirst({ where: { id, projectId }, select: { updatedAt: true } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { config: true, updatedAt: true } }),
  ]);
  if (!revisionRow) {
    throw notFound('page', { id });
  }
  const projectRevision = project?.updatedAt.toISOString() ?? '';
  const cacheKey = (revision: string) => `${projectId}:${id}:${revision}:${projectRevision}`;
  const known = searchDescriptionCache.get(cacheKey(revisionRow.updatedAt.toISOString()));
  if (known !== undefined) {
    return { description: known, revision: revisionRow.updatedAt.toISOString() };
  }
  // The body and its revision come from one read, so the text always matches the revision it's cached under.
  const page = await prisma.page.findFirst({ where: { id, projectId }, select: { content: true, updatedAt: true } });
  if (!page) {
    throw notFound('page', { id });
  }
  const revision = page.updatedAt.toISOString();
  const source = withoutFrontmatter(page.content).slice(0, SEARCH_DESCRIPTION_SOURCE_LIMIT);
  const content = interpolateVariablesWithin(source, variablesFromConfig(project?.config), SEARCH_DESCRIPTION_SOURCE_LIMIT);
  const description = pageDescription({ content, description: null });
  searchDescriptionCache.set(cacheKey(revision), description);
  if (searchDescriptionCache.size > SEARCH_DESCRIPTION_CACHE_LIMIT) {
    searchDescriptionCache.delete(searchDescriptionCache.keys().next().value as string);
  }
  return { description, revision };
};

/** A unique slug among a parent's children within one language, deriving from the
 *  title when absent. Scoped to (projectId, languageId, parentId) so two languages
 *  can each have e.g. `/introduction`. */
export const uniqueSiblingSlug = async (
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
export const recomputeProjectPaths = async (projectId: string, tx: Prisma.TransactionClient): Promise<PagePathChange[]> => {
  const pages = await tx.page.findMany({
    where: { projectId },
    select: { id: true, parentId: true, slug: true, path: true, updatedAt: true, branchId: true, languageId: true },
  });
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
  const updates = pages
    .map((p) => ({ id: p.id, branchId: p.branchId, languageId: p.languageId, path: pathOf(p.id), old: p.path, updatedAt: p.updatedAt }))
    .filter((u) => u.path !== u.old);
  for (const u of updates)
    await tx.page.update({ where: { id: u.id }, data: { path: u.path, updatedAt: new Date(Math.max(Date.now(), u.updatedAt.getTime() + 1)) } });
  return updates;
};

/** A move or slug change rewrites the paths of the page and its subtree. */
export const STRUCTURAL_UPDATE_TIMEOUT_MS = 30_000;

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
  new AppError({
    code: 'page:revision_conflict',
    message: 'This page changed. Review the saved version and keep your unsaved text.',
    details: { id, reason: 'revision_conflict' },
  });

const isRecordNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2025';

interface UpdatePageOptions {
  /** Restore exact recoverable values while retaining the current address. */
  restore?: boolean;
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
  const save = async (lockStructure: boolean) => {
    const prepared = lockStructure ? await prepareAddressLinks(projectId, { id, content: body.content }) : new Map();
    return prisma.$transaction(
      async (tx) => {
        if (lockStructure) {
          await tx.$queryRaw`SELECT 1 FROM "project" WHERE id = ${projectId} FOR NO KEY UPDATE`;
          await tx.$queryRaw`SELECT 1 FROM "page" WHERE "projectId" = ${projectId} ORDER BY id FOR NO KEY UPDATE`;
        } else {
          await tx.$queryRaw`SELECT 1 FROM "page" WHERE id = ${id} AND "projectId" = ${projectId} FOR NO KEY UPDATE`;
        }
        if (lockStructure) await assertAddressLinkRevisions(projectId, prepared, tx);
        const page = await tx.page.findFirst({ where: { id, projectId } });
        if (!page) throw notFound('page', { id });
        const route = pageRouteEdit(page, options?.restore ? {} : body);
        if (!lockStructure && route.structural) throw new StructuralPageEdit();
        const expectedUpdatedAt = options?.expectedUpdatedAt ?? (body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : undefined);
        if (expectedUpdatedAt && page.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw pageRevisionConflict(id);
        }
        // The slug/URL is decoupled from the title (Mintlify-style): it only changes
        // when the slug is set explicitly or the page is re-parented (which needs a
        // uniqueness re-check among the new siblings). A title-only edit â€” e.g. every
        // editor autosave keystroke â€” must NOT silently rewrite the slug/path.
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
        const nextConfig = options?.restore ? body.config : mergePageConfig(page.config, body.config);
        const historySnapshot = await snapshotPage(
          tx,
          page,
          {
            title: body.title ?? page.title,
            content: body.content ?? page.content,
            description: body.description === undefined ? page.description : body.description,
            icon: body.icon === undefined ? page.icon : body.icon,
            hidden: body.hidden ?? page.hidden,
            config: nextConfig === undefined ? page.config : nextConfig,
          },
          userId,
          options?.restore ?? false,
        );
        const updated = await tx.page
          .update({
            // With a precondition the write matches only the revision that was read;
            // a concurrent edit makes it match nothing (P2025) instead of being lost.
            where: expectedUpdatedAt ? { id, updatedAt: expectedUpdatedAt } : { id },
            data: {
              updatedAt: new Date(Math.max(Date.now(), page.updatedAt.getTime() + 1)),
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
        const addressChanges = structural
          ? await preservePageAddresses(projectId, await recomputeProjectPaths(projectId, tx), tx, prepared)
          : { redirectsAdded: 0, linksUpdated: 0, documentsSkipped: 0 };
        const saved = structural ? await tx.page.findFirstOrThrow({ where: { id, projectId } }) : updated;
        return {
          page,
          updated: { ...saved, ...addressChanges, historySnapshot, addressChanged: saved.path !== page.path },
        };
      },
      { timeout: STRUCTURAL_UPDATE_TIMEOUT_MS },
    );
  };
  let result: Awaited<ReturnType<typeof save>>;
  try {
    result = await save(pageRouteEdit(initial, options?.restore ? {} : body).structural);
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

type ReorderRow = {
  id: string;
  parentId: string | null;
  branchId: string;
  languageId: string;
  position: number;
  slug: string;
  translationKey: string | null;
};

/** Returned on unfiltered branch-list reads; ignores content-only edits. */
export const pageStructureRevision = (rows: readonly PageStructureRow[]) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        [...rows].sort((a, b) => a.id.localeCompare(b.id)).map((page) => [page.id, page.parentId, page.branchId, page.languageId, page.position]),
      ),
    )
    .digest('hex');

/** The languages a reorder moves pages into must belong to this site. */
const assertTargetLanguages = async (tx: Prisma.TransactionClient, projectId: string, body: BulkReorderPagesBody) => {
  // Every given id is checked, including an empty one from a caller that skipped
  // the request schema: it must fail here as "not found", not reach the database.
  const ids = [...new Set(body.items.flatMap((item) => (item.languageId === undefined ? [] : [item.languageId])))];
  if (ids.length === 0) return;
  const found = new Set((await tx.language.findMany({ where: { projectId, id: { in: ids } }, select: { id: true } })).map((language) => language.id));
  const missing = ids.find((id) => !found.has(id));
  if (missing !== undefined) throw notFound('language', { id: missing });
};

/** Give each page that changed language a free address among its new siblings
 *  (`intro` â†’ `intro-2`, the same suffixes page creation uses), and drop a
 *  translation link another page of the target language already holds, so the
 *  move never leaves two variants of one page in one language. */
const settleLanguageMoves = (tree: Map<string, ReorderRow>, before: Map<string, ReorderRow>, order: string[]) => {
  const rows = [...tree.values()];
  const changed = order.filter((id) => tree.get(id)?.languageId !== before.get(id)?.languageId);
  for (const id of changed) {
    const page = tree.get(id);
    if (!page) continue;
    const sameScope = (other: ReorderRow) => other.id !== page.id && other.branchId === page.branchId && other.languageId === page.languageId;
    const taken = new Set(rows.filter((other) => sameScope(other) && other.parentId === page.parentId).map((other) => other.slug));
    if (taken.has(page.slug)) {
      const base = page.slug;
      let suffix = 2;
      while (taken.has(`${base}-${suffix}`)) suffix += 1;
      page.slug = `${base}-${suffix}`;
    }
    if (page.translationKey && rows.some((other) => sameScope(other) && other.translationKey === page.translationKey)) {
      page.translationKey = null;
    }
  }
};

const reorderPagesAttempt = async (projectId: string, request: ReorderPagesBody) => {
  // Narrow intents can acquire a different current parent after preparation.
  // Parse all documents outside the lock, then verify their revisions inside it.
  const prepared = await prepareAddressLinks(projectId, undefined, 'pageId' in request ? undefined : request.items);
  const branchId = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "project" WHERE id = ${projectId} FOR NO KEY UPDATE`;
      await tx.$queryRaw`SELECT 1 FROM "page" WHERE "projectId" = ${projectId} ORDER BY id FOR NO KEY UPDATE`;
      await assertAddressLinkRevisions(projectId, prepared, tx);
      const pages: ReorderRow[] = await tx.page.findMany({
        where: { projectId },
        select: { id: true, parentId: true, branchId: true, languageId: true, position: true, slug: true, translationKey: true },
      });
      const byPage = new Map(pages.map((page) => [page.id, page]));
      let body: BulkReorderPagesBody;
      let moveBranchId: string | undefined;
      if ('pageId' in request) {
        const active = byPage.get(request.pageId);
        if (!active) throw notFound('page', { id: request.pageId });
        moveBranchId = active.branchId;
        if (
          request.expectedStructureRevision &&
          request.expectedStructureRevision !== pageStructureRevision(pages.filter((page) => page.branchId === active.branchId))
        ) {
          throw conflict('The page structure changed. Refresh the tree and try again.', { reason: 'structure_changed' });
        }
        if (request.parentId && !byPage.has(request.parentId)) throw notFound('page', { id: request.parentId });
        assertNoParentCycle(byPage, active.id, request.parentId);
        const parent = request.parentId ? byPage.get(request.parentId) : undefined;
        if (parent && (parent.branchId !== active.branchId || parent.languageId !== (request.languageId ?? active.languageId))) {
          throw badRequest('Pages can only be moved within one branch and under a parent in the destination language.');
        }
        if (request.languageId)
          await assertTargetLanguages(tx, projectId, {
            items: [{ id: active.id, parentId: request.parentId, position: 0, languageId: request.languageId }],
          });
        const items = resolvePageMove(pages, request);
        if (!items) throw conflict('The destination sibling changed. Refresh the tree and try again.', { reason: 'structure_changed' });
        body = { items };
      } else {
        body = request;
        if (request.expectedStructureRevision) {
          const branch = request.items[0] ? byPage.get(request.items[0].id)?.branchId : undefined;
          if (request.expectedStructureRevision !== pageStructureRevision(pages.filter((page) => page.branchId === branch))) {
            throw conflict('The page structure changed. Refresh the tree and try again.', { reason: 'structure_changed' });
          }
        }
      }
      const proposed = new Map<string, BulkReorderPagesBody['items'][number]>();
      for (const item of body.items) {
        if (proposed.has(item.id)) {
          throw badRequest('Each page can only appear once in a reorder request.', { id: item.id });
        }
        if (!byPage.has(item.id)) {
          throw notFound('page', { id: item.id });
        }
        if (item.parentId && !byPage.has(item.parentId)) {
          throw notFound('page', { id: item.parentId });
        }
        proposed.set(item.id, item);
      }
      await assertTargetLanguages(tx, projectId, body);
      const nextTree = new Map(
        pages.map((page) => {
          const item = proposed.get(page.id);
          return [page.id, { ...page, parentId: item ? item.parentId : page.parentId, languageId: item?.languageId ?? page.languageId }];
        }),
      );
      for (const item of body.items) {
        assertNoParentCycle(nextTree, item.id, item.parentId);
      }
      // A page that changes language takes its whole subtree along; a
      // descendant listed with its own language keeps that (and is checked below).
      const children = new Map<string, string[]>();
      for (const page of nextTree.values()) {
        if (!page.parentId) continue;
        children.set(page.parentId, [...(children.get(page.parentId) ?? []), page.id]);
      }
      const moved = new Set(body.items.map((item) => item.id));
      for (const item of body.items) {
        const languageId = nextTree.get(item.id)?.languageId;
        if (!languageId || languageId === byPage.get(item.id)?.languageId) continue;
        const stack = [...(children.get(item.id) ?? [])];
        while (stack.length > 0) {
          const id = stack.pop() as string;
          const page = nextTree.get(id);
          if (!page || proposed.get(id)?.languageId) continue;
          page.languageId = languageId;
          moved.add(id);
          stack.push(...(children.get(id) ?? []));
        }
      }
      for (const id of moved) {
        const page = nextTree.get(id);
        const parent = page?.parentId ? nextTree.get(page.parentId) : undefined;
        if (page && parent && (parent.branchId !== page.branchId || parent.languageId !== page.languageId)) {
          throw badRequest('Pages can only be reordered under parents in the same branch and language.', { id, parentId: parent.id });
        }
      }
      settleLanguageMoves(nextTree, byPage, [...moved]);
      for (const item of body.items) {
        const page = nextTree.get(item.id);
        const before = byPage.get(item.id);
        if (!page || before?.parentId === item.parentId || before?.languageId !== page.languageId) continue;
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
      for (const id of moved) {
        const page = nextTree.get(id);
        const before = byPage.get(id);
        const item = proposed.get(id);
        if (!page || !before) continue;
        await tx.page.updateMany({
          where: { id, projectId },
          data: {
            ...(item ? { parentId: item.parentId, position: item.position } : {}),
            ...(page.languageId === before.languageId ? {} : { languageId: page.languageId }),
            ...(page.slug === before.slug ? {} : { slug: page.slug }),
            ...(page.translationKey === before.translationKey ? {} : { translationKey: page.translationKey }),
          },
        });
      }
      const changes = await recomputeProjectPaths(projectId, tx);
      await preservePageAddresses(
        projectId,
        changes.map((change) => ({ ...change, oldLanguageId: byPage.get(change.id)?.languageId })),
        tx,
        prepared,
      );
      return moveBranchId ?? (body.items[0] ? byPage.get(body.items[0].id)?.branchId : undefined);
    },
    { timeout: STRUCTURAL_UPDATE_TIMEOUT_MS },
  );
  // Return the list scoped to the branch the moved pages live on (all items share
  // a branch â€” they were validated against their parents above). Empty items keep
  // the default-branch behavior.
  return listPages(projectId, undefined, branchId);
};

export const reorderPages = async (projectId: string, request: ReorderPagesBody) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await reorderPagesAttempt(projectId, request);
    } catch (error) {
      // A collaborator may commit while Markdown is being parsed. Retry the
      // narrow intent against fresh content, never an old structural snapshot.
      if (
        !('pageId' in request) ||
        attempt >= 2 ||
        !(error instanceof AppError) ||
        error.code !== 'page:address_conflict' ||
        error.details?.reason !== 'address_raced'
      )
        throw error;
    }
  }
};
