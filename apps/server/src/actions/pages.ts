import { Prisma, prisma } from '@midad/database';
import { joinPath, slugify } from '@midad/shared/utils';
import type { CreatePageBody, ReorderPagesBody, UpdatePageBody } from '@midad/validators';
import { notFound } from '@/errors';
import { ensureDefaultBranch } from './branches';
import { ensureDefaultLanguage } from './languages';
import { assertProjectInOrg } from './projects';

const pageListSelect = {
  id: true,
  parentId: true,
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
} as const;

/** Flat list of a project's pages on one branch (the default branch when none is
 *  given), ordered for tree assembly on the client. Scoped to a single language
 *  when `languageId` is given. */
export const listPages = async (projectId: string, languageId?: string, branchId?: string) => {
  const resolvedBranchId = branchId ?? (await ensureDefaultBranch(projectId)).id;
  return prisma.page.findMany({
    where: { projectId, branchId: resolvedBranchId, ...(languageId ? { languageId } : {}) },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: pageListSelect,
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
  projectId: string,
  languageId: string | null,
  branchId: string | null,
  parentId: string | null,
  desired: string,
  excludeId?: string,
): Promise<string> => {
  const base = slugify(desired) || 'page';
  let slug = base;
  let suffix = 1;
  for (;;) {
    const clash = await prisma.page.findFirst({
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
const PLACEHOLDER_TITLE_RE = /^(?:Untitled|New group)$/;

/** Resolve a parent's path, language, and branch. A child inherits both its
 *  parent's language and branch. */
const parentInfo = async (
  projectId: string,
  parentId: string | null,
): Promise<{ path: string | null; languageId: string | null; branchId: string | null }> => {
  if (!parentId) {
    return { path: null, languageId: null, branchId: null };
  }
  const parent = await prisma.page.findFirst({ where: { id: parentId, projectId }, select: { path: true, languageId: true, branchId: true } });
  if (!parent) {
    throw notFound('page', { id: parentId });
  }
  return { path: parent.path, languageId: parent.languageId, branchId: parent.branchId };
};

/** Recompute the materialized `path` of every page in a project from the tree. */
const recomputeProjectPaths = async (projectId: string): Promise<void> => {
  const pages = await prisma.page.findMany({ where: { projectId }, select: { id: true, parentId: true, slug: true, path: true } });
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
  await prisma.$transaction(updates.map((u) => prisma.page.update({ where: { id: u.id }, data: { path: u.path } })));
};

export const createPage = async (projectId: string, body: CreatePageBody) => {
  const parentId = body.parentId ?? null;
  const parent = await parentInfo(projectId, parentId);
  // A child inherits its parent's branch + language; otherwise use the requested
  // ones, falling back to the project's defaults (creating them if absent).
  const branchId = parent.branchId ?? body.branchId ?? (await ensureDefaultBranch(projectId)).id;
  const languageId = parent.languageId ?? body.languageId ?? (await ensureDefaultLanguage(projectId)).id;
  const slug = await uniqueSiblingSlug(projectId, languageId, branchId, parentId, body.slug || body.title);
  const maxPosition = await prisma.page.aggregate({ where: { projectId, branchId, languageId, parentId }, _max: { position: true } });
  return prisma.page.create({
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
      position: body.position ?? (maxPosition._max.position ?? -1) + 1,
    },
  });
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

export const updatePage = async (projectId: string, id: string, body: UpdatePageBody) => {
  const page = await prisma.page.findFirst({ where: { id, projectId } });
  if (!page) {
    throw notFound('page', { id });
  }
  // The slug/URL is decoupled from the title (Mintlify-style): it only changes
  // when the slug is set explicitly or the page is re-parented (which needs a
  // uniqueness re-check among the new siblings). A title-only edit — e.g. every
  // editor autosave keystroke — must NOT silently rewrite the slug/path.
  const nextParentId = body.parentId === undefined ? page.parentId : body.parentId;
  const slugChanged = body.slug !== undefined;
  const reparented = body.parentId !== undefined && nextParentId !== page.parentId;
  const shouldAdoptTitleSlug =
    !slugChanged &&
    body.title !== undefined &&
    body.title.trim() !== '' &&
    body.title !== page.title &&
    PLACEHOLDER_SLUG_RE.test(page.slug) &&
    PLACEHOLDER_TITLE_RE.test(page.title);
  const structural = slugChanged || reparented || shouldAdoptTitleSlug;
  let nextSlug = page.slug;
  if (structural) {
    const desiredSlug = body.slug || (shouldAdoptTitleSlug && body.title ? body.title : page.slug);
    nextSlug = await uniqueSiblingSlug(projectId, page.languageId, page.branchId, nextParentId, desiredSlug, id);
  }
  const nextConfig = mergePageConfig(page.config, body.config);
  const updated = await prisma.page.update({
    where: { id },
    data: {
      ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
      ...(body.title === undefined ? {} : { title: body.title }),
      slug: nextSlug,
      ...(body.icon === undefined ? {} : { icon: body.icon }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.content === undefined ? {} : { content: body.content }),
      ...(body.hidden === undefined ? {} : { hidden: body.hidden }),
      ...(body.translationKey === undefined ? {} : { translationKey: body.translationKey }),
      ...(nextConfig === undefined ? {} : { config: nextConfig ?? Prisma.JsonNull }),
    },
  });
  if (structural) {
    await recomputeProjectPaths(projectId);
    return getPage(projectId, id);
  }
  return updated;
};

export const deletePage = async (projectId: string, id: string) => {
  const page = await prisma.page.findFirst({ where: { id, projectId }, select: { id: true } });
  if (!page) {
    throw notFound('page', { id });
  }
  await prisma.page.delete({ where: { id } });
  return { id };
};

export const reorderPages = async (projectId: string, body: ReorderPagesBody) => {
  await prisma.$transaction(
    body.items.map((item) =>
      prisma.page.updateMany({ where: { id: item.id, projectId }, data: { parentId: item.parentId, position: item.position } }),
    ),
  );
  await recomputeProjectPaths(projectId);
  return listPages(projectId);
};

export { assertProjectInOrg };
