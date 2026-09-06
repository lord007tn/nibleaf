import { type Branch, type Prisma, prisma } from '@nibleaf/database';
import { newId } from '@nibleaf/shared/ids';
import type { CreateBranchBody } from '@nibleaf/validators';
import { conflict, notFound } from '@/errors';

/** Every branch of a project, default ('main') first. */
export const listBranches = async (projectId: string): Promise<Branch[]> =>
  await prisma.branch.findMany({ where: { projectId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });

/** The project's required default branch. Missing data is an invariant error. */
export const getDefaultBranch = async (projectId: string) => {
  const defaults = await prisma.branch.findMany({ where: { projectId, isDefault: true }, take: 2 });
  if (defaults.length !== 1 || !defaults[0]) {
    throw new Error(`Project ${projectId} must have exactly one default branch.`);
  }
  return defaults[0];
};

/** Throw unless the branch exists in the project; returns it. */
export const assertBranchInProject = async (projectId: string, id: string) => {
  const branch = await prisma.branch.findFirst({ where: { id, projectId } });
  if (!branch) {
    throw notFound('branch', { id });
  }
  return branch;
};

/** Create an empty, non-default branch used to assemble an authoritative
 * importer replacement away from the editable main tree. It is promoted only
 * after the whole import succeeds; failures can delete it without touching the
 * user's current draft. */
export const createImportReplacementBranch = async (projectId: string, source: string, preserveExisting: boolean) => {
  const name = `import-${source}-${newId()}`;
  return preserveExisting ? createBranch(projectId, { name }) : prisma.branch.create({ data: { projectId, name, isDefault: false } });
};

/** Atomically replace main with a completed import branch and, when supplied,
 * apply the imported project chrome in the same commit. */
export const promoteImportReplacementBranch = async (projectId: string, id: string, projectConfig?: Prisma.InputJsonValue) => {
  const branch = await assertBranchInProject(projectId, id);
  if (branch.isDefault) throw conflict('The default branch cannot be promoted as an import replacement.');
  const main = await getDefaultBranch(projectId);
  await prisma.$transaction(async (tx) => {
    await tx.page.deleteMany({ where: { projectId, branchId: main.id } });
    await tx.page.updateMany({ where: { projectId, branchId: branch.id }, data: { branchId: main.id } });
    await tx.branch.delete({ where: { id: branch.id } });
    if (projectConfig !== undefined) {
      await tx.project.update({ where: { id: projectId }, data: { config: projectConfig } });
    }
  });
  return main;
};

/** Create a branch by forking another branch's pages (the default by default).
 *  Pages are deep-copied with fresh ids and remapped parent links, so the new
 *  branch is an independent, editable copy across every language. */
export const createBranch = async (projectId: string, body: CreateBranchBody) => {
  const name = body.name.trim();
  const clash = await prisma.branch.findFirst({ where: { projectId, name }, select: { id: true } });
  if (clash) {
    throw conflict('A branch with that name already exists.', { name });
  }
  const source = body.fromBranchId ? await assertBranchInProject(projectId, body.fromBranchId) : await getDefaultBranch(projectId);

  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.create({ data: { projectId, name, isDefault: false } });
    const sourcePages = await tx.page.findMany({ where: { projectId, branchId: source.id }, orderBy: { position: 'asc' } });
    // old page id → new page id, so parentId links can be remapped onto the copies.
    const idMap = new Map<string, string>();
    for (const p of sourcePages) {
      idMap.set(p.id, newId());
    }
    if (sourcePages.length > 0) {
      await tx.page.createMany({
        data: sourcePages.map((p) => ({
          id: idMap.get(p.id) ?? newId(),
          projectId,
          branchId: branch.id,
          languageId: p.languageId,
          parentId: p.parentId ? (idMap.get(p.parentId) ?? null) : null,
          kind: p.kind,
          title: p.title,
          slug: p.slug,
          path: p.path,
          icon: p.icon,
          description: p.description,
          content: p.content,
          config: p.config ?? undefined,
          translationKey: p.translationKey,
          position: p.position,
          hidden: p.hidden,
        })),
      });
    }
    return branch;
  });
};

/** Merge a branch into the default branch ('main'): main adopts this branch's
 *  (edited) pages, then the now-consumed branch is removed. This is a squash /
 *  promote — main's prior pages are replaced, so concurrent edits made directly
 *  on main since the fork are overwritten. */
export const mergeBranch = async (projectId: string, id: string) => {
  const branch = await assertBranchInProject(projectId, id);
  if (branch.isDefault) {
    throw conflict('The default branch cannot be merged into itself.');
  }
  const main = await getDefaultBranch(projectId);
  await prisma.$transaction(async (tx) => {
    // Replace main's pages with this branch's pages (which keep their ids + paths
    // + remapped parent links), then drop the emptied branch.
    await tx.page.deleteMany({ where: { projectId, branchId: main.id } });
    await tx.page.updateMany({ where: { projectId, branchId: branch.id }, data: { branchId: main.id } });
    await tx.branch.delete({ where: { id: branch.id } });
  });
  return main;
};

/** Delete a non-default branch (its pages cascade away). */
export const deleteBranch = async (projectId: string, id: string) => {
  const branch = await assertBranchInProject(projectId, id);
  if (branch.isDefault) {
    throw conflict('You cannot delete the default branch.');
  }
  await prisma.branch.delete({ where: { id } });
  return { id };
};
