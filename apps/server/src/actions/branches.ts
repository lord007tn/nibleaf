import { createHash } from 'node:crypto';
import { type Branch, Prisma, prisma } from '@nibleaf/database';
import { newId } from '@nibleaf/shared/ids';
import type { CreateBranchBody, MergeBranchBody } from '@nibleaf/validators';
import { AppError, conflict, notFound } from '@/errors';
import { buildForkBaseline, diffMainSinceFork, forkPointOf, type MergePreview, planPromote } from './branch-fork';
import { recomputeProjectPaths } from './pages';

/** The fork baseline is promote's bookkeeping and can be large; API responses
 *  leave it out. */
const publicBranch = { forkBaseline: true } as const;

/** Every branch of a project, default ('main') first. */
export const listBranches = async (projectId: string): Promise<Omit<Branch, 'forkBaseline'>[]> =>
  await prisma.branch.findMany({ where: { projectId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], omit: publicBranch });

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

const draftFingerprint = async (db: Prisma.TransactionClient, projectId: string, branchId: string) => {
  const pages = await db.page.findMany({
    where: { projectId, branchId },
    orderBy: { id: 'asc' },
    select: { id: true, branchId: true, languageId: true, parentId: true, path: true, slug: true, kind: true, position: true, updatedAt: true },
  });
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { config: true } });
  return createHash('sha256')
    .update(JSON.stringify({ pages, config: project.config }))
    .digest('hex');
};

const importTransactionOptions = { isolationLevel: 'Serializable', timeout: 30_000 } as const;
const importTransactionFailure = (error: unknown): never => {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2034') throw conflict('The draft changed during import. Your edits were preserved; retry the import.');
    if (error.code === 'P2028') throw new AppError({ code: 'import:busy', message: 'The import could not complete. Try again shortly.' });
  }
  throw error;
};

export const captureImportDraft = async (projectId: string) => {
  const main = await getDefaultBranch(projectId);
  return prisma.$transaction((tx) => draftFingerprint(tx, projectId, main.id), importTransactionOptions).catch(importTransactionFailure);
};

/** Atomically replace main with a completed import branch and, when supplied,
 * apply the imported project chrome in the same commit. */
export const promoteImportReplacementBranch = async (
  projectId: string,
  id: string,
  projectConfig?: Prisma.InputJsonValue,
  expectedDraft?: string,
) => {
  const branch = await assertBranchInProject(projectId, id);
  if (branch.isDefault) throw conflict('The default branch cannot be promoted as an import replacement.');
  const main = await getDefaultBranch(projectId);
  await prisma
    .$transaction(async (tx) => {
      if (expectedDraft !== undefined && (await draftFingerprint(tx, projectId, main.id)) !== expectedDraft) {
        throw conflict('The draft changed during import. Your edits were preserved; retry the import.');
      }
      await tx.page.deleteMany({ where: { projectId, branchId: main.id } });
      await tx.page.updateMany({ where: { projectId, branchId: branch.id }, data: { branchId: main.id } });
      await tx.branch.delete({ where: { id: branch.id } });
      if (projectConfig !== undefined) {
        await tx.project.update({ where: { id: projectId }, data: { config: projectConfig } });
      }
    }, importTransactionOptions)
    .catch(importTransactionFailure);
  return main;
};

/** Create a branch by forking another branch's pages (the default by default).
 *  Pages are deep-copied with fresh ids and remapped parent links, so the new
 *  branch is an independent, editable copy across every language.
 *
 *  A fork of main records the fork point (`forkedAt` + a baseline of main's
 *  pages, see ./branch-fork) so a later promote can tell what changed on main.
 *  The copies carry `forkedAt` as their `updatedAt`, which is how promote tells
 *  an edited copy from an untouched one. A fork of another version inherits
 *  that version's fork time without a baseline, so promote compares main from
 *  the earlier fork (never later) and reports the comparison as incomplete. */
export const createBranch = async (projectId: string, body: CreateBranchBody) => {
  const name = body.name.trim();
  const clash = await prisma.branch.findFirst({ where: { projectId, name }, select: { id: true } });
  if (clash) {
    throw conflict('A branch with that name already exists.', { name });
  }
  const source = body.fromBranchId ? await assertBranchInProject(projectId, body.fromBranchId) : await getDefaultBranch(projectId);

  return prisma.$transaction(async (tx) => {
    // Creating the copies is a structural page write: project lock first. It
    // also keeps the baseline consistent with structural changes on main.
    await lockProject(tx, projectId);
    const forkedAt = new Date();
    const sourcePages = await tx.page.findMany({ where: { projectId, branchId: source.id }, orderBy: { position: 'asc' } });
    // old page id → new page id, so parentId links can be remapped onto the copies.
    const idMap = new Map<string, string>();
    for (const p of sourcePages) {
      idMap.set(p.id, newId());
    }
    const copyIdOf = (id: string) => idMap.get(id) ?? newId();
    const fork = source.isDefault ? { forkedAt, forkBaseline: buildForkBaseline(sourcePages, copyIdOf) } : { forkedAt: forkPointOf(source).forkedAt };
    const branch = await tx.branch.create({ data: { projectId, name, isDefault: false, ...fork }, omit: publicBranch });
    if (sourcePages.length > 0) {
      await tx.page.createMany({
        data: sourcePages.map((p) => ({
          id: copyIdOf(p.id),
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
          createdAt: forkedAt,
          updatedAt: forkedAt,
        })),
      });
    }
    return branch;
  });
};

const mainPageSelect = { id: true, parentId: true, kind: true, title: true, path: true, languageId: true, createdAt: true, updatedAt: true } as const;
const versionPageSelect = { id: true, parentId: true, languageId: true, path: true, updatedAt: true } as const;

/** The shared page-write project lock (see the page-write lock protocol): a
 *  structural page change takes it first, before any page row lock. NO KEY
 *  UPDATE, never FOR UPDATE, so inserts that reference the project (analytics,
 *  sessions, comments, deployments) are not blocked. */
const lockProject = (tx: Prisma.TransactionClient, projectId: string) =>
  tx.$queryRaw(Prisma.sql`SELECT 1 FROM "project" WHERE "id" = ${projectId} FOR NO KEY UPDATE`);

/** Read the version, main and the fork point for a promote. With `lock`, it
 *  follows the page-write lock protocol: the project row first, then the
 *  version row, then main's page rows in ascending id order, all FOR NO KEY
 *  UPDATE. A save on main therefore can't land between this check and the
 *  promote that follows in the same transaction; a save already in flight is
 *  waited for and then seen. Pages created on main meanwhile are kept by
 *  promote anyway (it deletes by id). */
const readPromoteState = async (tx: Prisma.TransactionClient, projectId: string, branchId: string, mainId: string, lock: boolean) => {
  if (lock) {
    await lockProject(tx, projectId);
    const locked = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "branch" WHERE "id" = ${branchId} AND "projectId" = ${projectId} FOR NO KEY UPDATE`,
    );
    if (locked.length === 0) throw notFound('branch', { id: branchId });
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "page" WHERE "projectId" = ${projectId} AND "branchId" = ${mainId} ORDER BY "id" ASC FOR NO KEY UPDATE`,
    );
  }
  const branch = await tx.branch.findFirst({ where: { id: branchId, projectId }, select: { createdAt: true, forkedAt: true, forkBaseline: true } });
  if (!branch) throw notFound('branch', { id: branchId });
  const mainPages = await tx.page.findMany({ where: { projectId, branchId: mainId }, select: mainPageSelect });
  const versionPages = await tx.page.findMany({ where: { projectId, branchId }, select: versionPageSelect });
  const languages = await tx.language.findMany({ where: { projectId }, select: { id: true, code: true } });
  const fork = forkPointOf(branch);
  const preview = diffMainSinceFork(mainPages, fork, new Map(languages.map((l) => [l.id, l.code])));
  return { fork, mainPages, versionPages, preview };
};

const assertPromotable = async (projectId: string, id: string) => {
  const branch = await assertBranchInProject(projectId, id);
  if (branch.isDefault) {
    throw conflict('The default branch cannot be merged into itself.');
  }
  return { branch, main: await getDefaultBranch(projectId) };
};

/** What changed on main since this version was created (read-only). */
export const getMergePreview = async (projectId: string, id: string): Promise<MergePreview> => {
  const { branch, main } = await assertPromotable(projectId, id);
  return prisma.$transaction(async (tx) => (await readPromoteState(tx, projectId, branch.id, main.id, false)).preview);
};

/** Promote a version into the default branch ('main'): main adopts the
 *  version's pages, then the consumed version is removed. Pages on main that
 *  changed since the fork are checked first: unless the caller confirms with
 *  `confirmChangedOnMain`, promote stops with 409 `branch:main_changed` and
 *  changes nothing. Pages added on main since the fork are kept; see
 *  ./branch-fork for the full keep/replace/drop rules. The check and the
 *  promote share one locked transaction. */
export const mergeBranch = async (projectId: string, id: string, body: MergeBranchBody = {}) => {
  const { branch, main } = await assertPromotable(projectId, id);
  await prisma.$transaction(
    async (tx) => {
      const state = await readPromoteState(tx, projectId, branch.id, main.id, true);
      if (state.preview.changedOnMainSinceFork.length > 0 && body.confirmChangedOnMain !== true) {
        throw new AppError({
          code: 'branch:main_changed',
          message: 'Pages on main changed since this version was created. Review them before promoting.',
          details: { ...state.preview },
        });
      }
      const plan = planPromote(state.mainPages, state.versionPages, state.fork);
      // Re-home kept main pages before their old parents go: page deletes
      // cascade to children.
      for (const move of plan.reparent) {
        await tx.page.update({ where: { id: move.id }, data: { parentId: move.parentId } });
      }
      if (plan.dropVersionIds.length > 0) {
        await tx.page.deleteMany({ where: { projectId, branchId: branch.id, id: { in: plan.dropVersionIds } } });
      }
      if (plan.deleteMainIds.length > 0) {
        await tx.page.deleteMany({ where: { projectId, branchId: main.id, id: { in: plan.deleteMainIds } } });
      }
      await tx.page.updateMany({ where: { projectId, branchId: branch.id }, data: { branchId: main.id } });
      await tx.branch.delete({ where: { id: branch.id } });
      if (plan.reparent.length > 0) await recomputeProjectPaths(projectId, tx);
    },
    { timeout: 30_000 },
  );
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
