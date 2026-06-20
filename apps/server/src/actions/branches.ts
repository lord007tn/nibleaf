import { prisma } from '@plume/database';
import { newId } from '@plume/shared/ids';
import type { CreateBranchBody } from '@plume/validators';
import { conflict, notFound } from '@/errors';

/** Every branch of a project, default ('main') first. */
export const listBranches = (projectId: string) =>
  prisma.branch.findMany({ where: { projectId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });

/** The project's default branch ('main'), creating it if the project has none.
 *  Mirrors ensureDefaultLanguage so older projects self-heal. */
export const ensureDefaultBranch = async (projectId: string) => {
  const existing = await prisma.branch.findFirst({ where: { projectId, isDefault: true } });
  if (existing) {
    return existing;
  }
  const any = await prisma.branch.findFirst({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  if (any) {
    return prisma.branch.update({ where: { id: any.id }, data: { isDefault: true } });
  }
  return prisma.branch.create({ data: { projectId, name: 'main', isDefault: true } });
};

/** Throw unless the branch exists in the project; returns it. */
export const assertBranchInProject = async (projectId: string, id: string) => {
  const branch = await prisma.branch.findFirst({ where: { id, projectId } });
  if (!branch) {
    throw notFound('branch', { id });
  }
  return branch;
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
  const source = body.fromBranchId ? await assertBranchInProject(projectId, body.fromBranchId) : await ensureDefaultBranch(projectId);

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
          position: p.position,
          hidden: p.hidden,
        })),
      });
    }
    return branch;
  });
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
