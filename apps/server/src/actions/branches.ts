import { createHash } from 'node:crypto';
import { type Branch, Prisma, prisma } from '@nibleaf/database';
import { newId } from '@nibleaf/shared/ids';
import type { CreateBranchBody, MergeBranchBody } from '@nibleaf/validators';
import { AppError, conflict, notFound } from '@/errors';
import { analyzePromote, buildForkBaseline, forkPointOf, type MergePreview, type PromotePageRow, pageContentHash } from './branch-fork';
import { recomputeProjectPaths } from './pages';

/** The fork baseline is promote's bookkeeping and can be large; API responses
 *  and ordinary lookups leave it out. Only the promote read loads it. */
const publicBranch = { forkBaseline: true } as const;

/** Every branch of a project, default ('main') first. */
export const listBranches = async (projectId: string): Promise<Omit<Branch, 'forkBaseline'>[]> =>
  await prisma.branch.findMany({ where: { projectId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], omit: publicBranch });

/** The project's required default branch. Missing data is an invariant error. */
export const getDefaultBranch = async (projectId: string) => {
  const defaults = await prisma.branch.findMany({ where: { projectId, isDefault: true }, take: 2, omit: publicBranch });
  if (defaults.length !== 1 || !defaults[0]) {
    throw new Error(`Project ${projectId} must have exactly one default branch.`);
  }
  return defaults[0];
};

/** Throw unless the branch exists in the project; returns it (without the
 *  fork baseline). */
export const assertBranchInProject = async (projectId: string, id: string) => {
  const branch = await prisma.branch.findFirst({ where: { id, projectId }, omit: publicBranch });
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
  return preserveExisting
    ? createBranch(projectId, { name })
    : prisma.branch.create({ data: { projectId, name, isDefault: false }, omit: publicBranch });
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

/** The shared page-write project lock (see the page-write lock protocol): a
 *  structural page change takes it first, before any page row lock. NO KEY
 *  UPDATE, never FOR UPDATE, so inserts that reference the project (analytics,
 *  sessions, comments, deployments) are not blocked. */
const lockProject = (tx: Prisma.TransactionClient, projectId: string) =>
  tx.$queryRaw(Prisma.sql`SELECT 1 FROM "project" WHERE "id" = ${projectId} FOR NO KEY UPDATE`);

/** Create a branch by forking another branch's pages (the default by default).
 *  Pages are deep-copied with fresh ids and remapped parent links, so the new
 *  branch is an independent, editable copy across every language.
 *
 *  A fork of main records the fork point (`forkedAt` + a baseline of main's
 *  pages and their copies, see ./branch-fork) so a later promote can tell what
 *  changed on each side. A fork of another version inherits that version's fork
 *  time without a baseline, so promote compares main from the earlier fork
 *  (never later) and reports the comparison as incomplete. */
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
    const forkedAt = source.isDefault ? new Date() : (source.forkedAt ?? source.createdAt);
    const sourcePages = await tx.page.findMany({ where: { projectId, branchId: source.id }, orderBy: { position: 'asc' } });
    // old page id → new page id, so parentId links can be remapped onto the copies.
    const idMap = new Map<string, string>();
    for (const p of sourcePages) {
      idMap.set(p.id, newId());
    }
    const copyIdOf = (id: string) => idMap.get(id) ?? newId();
    const branch = await tx.branch.create({ data: { projectId, name, isDefault: false, forkedAt }, omit: publicBranch });
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
        })),
      });
    }
    if (source.isDefault) {
      // Hash both sides with the same SQL promote uses later.
      const hashes = await tx.$queryRaw<{ id: string; hash: string }[]>(
        Prisma.sql`SELECT "id", ${pageContentHash()} AS "hash" FROM "page" WHERE "projectId" = ${projectId} AND "branchId" IN (${source.id}, ${branch.id})`,
      );
      const hashById = new Map(hashes.map((h) => [h.id, h.hash]));
      const forkBaseline = buildForkBaseline(sourcePages, copyIdOf, (pageId) => hashById.get(pageId) ?? '');
      await tx.branch.update({ where: { id: branch.id }, data: { forkBaseline }, select: { id: true } });
    }
    return branch;
  });
};

type PromoteRow = PromotePageRow & { branchId: string };

/** Read the version, main and the fork point for a promote, and analyze them.
 *  With `lock` (inside the promote transaction) it follows the page-write lock
 *  protocol: the project row, then the version row, then the page rows of BOTH
 *  branches in one ascending-id pass, all FOR NO KEY UPDATE. That same locking
 *  query is the read, so no save on either side can land between it and the
 *  writes that follow; a save already in flight is waited for, then seen.
 *  Without `lock` it is a plain read (the preview). */
const readPromoteState = async (db: Prisma.TransactionClient, projectId: string, branchId: string, mainId: string, lock: boolean) => {
  if (lock) {
    await lockProject(db, projectId);
    const locked = await db.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "branch" WHERE "id" = ${branchId} AND "projectId" = ${projectId} FOR NO KEY UPDATE`,
    );
    if (locked.length === 0) throw notFound('branch', { id: branchId });
  }
  const branch = await db.branch.findFirst({ where: { id: branchId, projectId }, select: { createdAt: true, forkedAt: true, forkBaseline: true } });
  if (!branch) throw notFound('branch', { id: branchId });
  const rows = await db.$queryRaw<PromoteRow[]>(
    Prisma.sql`SELECT "id", "branchId", "parentId", "kind"::text AS "kind", "title", "slug", "path", "languageId", "position", "createdAt", "updatedAt", ${pageContentHash()} AS "hash"
      FROM "page" WHERE "projectId" = ${projectId} AND "branchId" IN (${mainId}, ${branchId})
      ORDER BY "id" ASC ${lock ? Prisma.sql`FOR NO KEY UPDATE` : Prisma.empty}`,
  );
  const languages = await db.language.findMany({ where: { projectId }, select: { id: true, code: true } });
  const mainPages = rows.filter((r) => r.branchId === mainId);
  const versionPages = rows.filter((r) => r.branchId === branchId);
  return { rows, ...analyzePromote(mainPages, versionPages, forkPointOf(branch), new Map(languages.map((l) => [l.id, l.code]))) };
};

const assertPromotable = async (projectId: string, id: string) => {
  const branch = await assertBranchInProject(projectId, id);
  if (branch.isDefault) {
    throw conflict('The default branch cannot be merged into itself.');
  }
  return { branch, main: await getDefaultBranch(projectId) };
};

/** What changed on main since this version was created (a plain read). */
export const getMergePreview = async (projectId: string, id: string): Promise<MergePreview> => {
  const { branch, main } = await assertPromotable(projectId, id);
  return (await readPromoteState(prisma, projectId, branch.id, main.id, false)).preview;
};

/** A conditional write found its row changed or gone. Nothing is committed. */
const promoteRaced = () => conflict('Pages changed while promoting. Nothing was changed; try again.', { reason: 'promote_raced' });

const contentFields = {
  kind: true,
  title: true,
  slug: true,
  icon: true,
  description: true,
  content: true,
  config: true,
  translationKey: true,
  hidden: true,
} as const;

/** Conditional bulk delete: every row must still carry the `updatedAt` read. */
const deleteExactly = async (tx: Prisma.TransactionClient, where: Prisma.PageWhereInput, rows: Array<{ id: string; updatedAt: Date }>) => {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { count } = await tx.page.deleteMany({ where: { ...where, OR: chunk.map(({ id, updatedAt }) => ({ id, updatedAt })) } });
    if (count !== chunk.length) throw promoteRaced();
  }
};

/** Promote a version into the default branch ('main'). Pages on main that
 *  changed since the fork are checked first: unless the caller confirms with
 *  `confirmChangedOnMain`, promote stops with 409 `branch:main_changed` and
 *  changes nothing. Then main's pages are updated in place from the version
 *  (their ids stay stable), new version pages move in, and the version is
 *  removed; see ./branch-fork for the full rules. The check and every write
 *  share one locked transaction, and every write is conditional on the row it
 *  read. */
export const mergeBranch = async (projectId: string, id: string, body: MergeBranchBody = {}) => {
  const { branch, main } = await assertPromotable(projectId, id);
  await prisma.$transaction(
    async (tx) => {
      const { rows, preview, plan } = await readPromoteState(tx, projectId, branch.id, main.id, true);
      if (preview.changedOnMainSinceFork.length > 0 && body.confirmChangedOnMain !== true) {
        throw new AppError({
          code: 'branch:main_changed',
          message: 'Pages on main changed since this version was created. Review them before promoting.',
          details: { ...preview },
        });
      }
      const seen = new Map(rows.map((r) => [r.id, r.updatedAt]));
      const row = (rowId: string) => ({ id: rowId, updatedAt: seen.get(rowId) ?? new Date(0) });
      const one = (count: number) => {
        if (count !== 1) throw promoteRaced();
      };

      const sourceIds = plan.mainUpdates.flatMap((u) => (u.fromCopyId ? [u.fromCopyId] : []));
      const sourceRows =
        sourceIds.length > 0
          ? await tx.page.findMany({ where: { id: { in: sourceIds }, projectId, branchId: branch.id }, select: { id: true, ...contentFields } })
          : [];
      const sources = new Map(sourceRows.map((p) => [p.id, p]));
      for (const update of plan.mainUpdates) {
        const source = update.fromCopyId ? sources.get(update.fromCopyId) : undefined;
        if (update.fromCopyId && !source) throw promoteRaced();
        const content = source
          ? {
              kind: source.kind,
              title: source.title,
              slug: source.slug,
              icon: source.icon,
              description: source.description,
              content: source.content,
              config: source.config ?? Prisma.DbNull,
              translationKey: source.translationKey,
              hidden: source.hidden,
            }
          : {};
        one((await tx.page.updateMany({ where: { ...row(update.id), projectId, branchId: main.id }, data: { ...content, ...update.data } })).count);
      }
      for (const move of plan.moves) {
        one(
          (await tx.page.updateMany({ where: { ...row(move.id), projectId, branchId: branch.id }, data: { branchId: main.id, ...move.data } })).count,
        );
      }
      // Comments on a consumed copy follow it to the main page.
      const consumedIds = plan.consumed.map((c) => c.copyId);
      if (consumedIds.length > 0) {
        const mainOf = new Map(plan.consumed.map((c) => [c.copyId, c.mainId]));
        const commented = await tx.comment.groupBy({ by: ['pageId'], where: { pageId: { in: consumedIds } } });
        for (const { pageId } of commented) {
          const target = pageId ? mainOf.get(pageId) : undefined;
          if (pageId && target) await tx.comment.updateMany({ where: { pageId }, data: { pageId: target } });
        }
      }
      await deleteExactly(tx, { projectId, branchId: branch.id }, [...consumedIds, ...plan.dropVersionIds].map(row));
      await deleteExactly(tx, { projectId, branchId: main.id }, plan.deleteMainIds.map(row));
      // Every version page was moved, folded or dropped; anything left was
      // created after the read and would be lost with the version.
      if ((await tx.page.count({ where: { projectId, branchId: branch.id } })) > 0) throw promoteRaced();
      await tx.branch.delete({ where: { id: branch.id } });
      await recomputeProjectPaths(projectId, tx);
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
