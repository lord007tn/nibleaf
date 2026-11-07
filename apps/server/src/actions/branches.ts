import { createHash } from 'node:crypto';
import { type Branch, type PageKind, Prisma, prisma } from '@nibleaf/database';
import { newId } from '@nibleaf/shared/ids';
import type { CreateBranchBody } from '@nibleaf/validators';
import { AppError, conflict, notFound } from '@/errors';
import {
  buildForkBaseline,
  type ChangedOnMainPage,
  changedOnMainSinceFork,
  type HashedPageRow,
  type MergePreview,
  pageContentHash,
  parseForkBaseline,
} from './branch-fork';

/** The fork baseline is promote's bookkeeping and can be large: API responses
 *  and ordinary lookups leave it out. */
const withoutBaseline = { forkBaseline: true } as const;

/** Every branch of a project, default ('main') first. */
export const listBranches = async (projectId: string): Promise<Omit<Branch, 'forkBaseline'>[]> =>
  await prisma.branch.findMany({ where: { projectId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], omit: withoutBaseline });

/** The project's required default branch. Missing data is an invariant error. */
export const getDefaultBranch = async (projectId: string) => {
  const defaults = await prisma.branch.findMany({ where: { projectId, isDefault: true }, take: 2, omit: withoutBaseline });
  if (defaults.length !== 1 || !defaults[0]) {
    throw new Error(`Project ${projectId} must have exactly one default branch.`);
  }
  return defaults[0];
};

/** Throw unless the branch exists in the project; returns it. */
export const assertBranchInProject = async (projectId: string, id: string) => {
  const branch = await prisma.branch.findFirst({ where: { id, projectId }, omit: withoutBaseline });
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
    : prisma.branch.create({ data: { projectId, name, isDefault: false }, omit: withoutBaseline });
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

/** The shared page-write project lock: a structural page change takes it
 *  first, before any page row lock. NO KEY UPDATE, never FOR UPDATE, so inserts
 *  that reference the project (analytics, sessions, comments, deployments) are
 *  not blocked. */
const lockProject = (tx: Prisma.TransactionClient, projectId: string) =>
  tx.$queryRaw(Prisma.sql`SELECT 1 FROM "project" WHERE "id" = ${projectId} FOR NO KEY UPDATE`);

type SourcePageRow = HashedPageRow & {
  parentId: string | null;
  kind: PageKind;
  slug: string;
  icon: string | null;
  description: string | null;
  content: string;
  config: Prisma.JsonValue | null;
  translationKey: string | null;
  position: number;
  hidden: boolean;
};

/** Where a new version forks from: main's pages now, or the source version's
 *  own fork (copied as values, never a reference, so deleting or promoting the
 *  source later cannot change it). */
const forkPointFor = async (
  tx: Prisma.TransactionClient,
  projectId: string,
  source: { id: string; isDefault: boolean },
  sourcePages: SourcePageRow[],
): Promise<{ forkedAt: Date | null; forkBaseline: Prisma.InputJsonObject | typeof Prisma.DbNull }> => {
  if (source.isDefault) return { forkedAt: new Date(), forkBaseline: buildForkBaseline(sourcePages) };
  // Read under the project lock: promoting or deleting the source holds it too.
  const from = await tx.branch.findFirst({ where: { id: source.id, projectId }, select: { forkedAt: true, forkBaseline: true } });
  if (!from) throw notFound('branch', { id: source.id });
  const baseline = parseForkBaseline(from);
  return baseline && from.forkedAt ? { forkedAt: from.forkedAt, forkBaseline: baseline } : { forkedAt: null, forkBaseline: Prisma.DbNull };
};

/** Create a branch by forking another branch's pages (the default by default).
 *  Pages are deep-copied with fresh ids and remapped parent links, so the new
 *  branch is an independent, editable copy across every language.
 *
 *  A copy of main records its fork baseline (see ./branch-fork): main's pages
 *  are read and hashed in the same statement, under the project lock, so a
 *  save cannot land between the read and the hash. A copy of another version
 *  copies that version's fork time and baseline, or gets none when the source
 *  has none. */
export const createBranch = async (projectId: string, body: CreateBranchBody) => {
  const name = body.name.trim();
  const clash = await prisma.branch.findFirst({ where: { projectId, name }, select: { id: true } });
  if (clash) {
    throw conflict('A branch with that name already exists.', { name });
  }
  const source = body.fromBranchId ? await assertBranchInProject(projectId, body.fromBranchId) : await getDefaultBranch(projectId);

  return prisma.$transaction(
    async (tx) => {
      await lockProject(tx, projectId);
      const sourcePages = await tx.$queryRaw<SourcePageRow[]>(
        Prisma.sql`SELECT "id", "languageId", "parentId", "kind"::text AS "kind", "title", "slug", "path", "icon", "description", "content",
            "config", "translationKey", "position", "hidden", "updatedAt", ${pageContentHash()} AS "hash"
          FROM "page" WHERE "projectId" = ${projectId} AND "branchId" = ${source.id} ORDER BY "position" ASC`,
      );
      const fork = await forkPointFor(tx, projectId, source, sourcePages);
      const branch = await tx.branch.create({ data: { projectId, name, isDefault: false, ...fork }, omit: withoutBaseline });
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
    },
    { timeout: 30_000 },
  );
};

const languageCodes = async (db: Prisma.TransactionClient, projectId: string) =>
  new Map((await db.language.findMany({ where: { projectId }, select: { id: true, code: true } })).map((l) => [l.id, l.code]));

const assertPromotable = async (projectId: string, id: string) => {
  const branch = await assertBranchInProject(projectId, id);
  if (branch.isDefault) {
    throw conflict('The default branch cannot be merged into itself.');
  }
  return { branch, main: await getDefaultBranch(projectId) };
};

/** What changed on main since this version's pages were copied from it (a
 *  plain read; promote repeats the comparison under its locks). Without a
 *  baseline the list is empty and `baselineComplete` is false. */
export const getMergePreview = async (projectId: string, id: string): Promise<MergePreview> => {
  const { branch, main } = await assertPromotable(projectId, id);
  const stored = await prisma.branch.findFirst({ where: { id: branch.id, projectId }, select: { forkedAt: true, forkBaseline: true } });
  const baseline = stored ? parseForkBaseline(stored) : null;
  if (!baseline) return { changedOnMainSinceFork: [], baselineComplete: false };
  const mainPages = await prisma.$queryRaw<HashedPageRow[]>(
    Prisma.sql`SELECT "id", "title", "path", "languageId", "updatedAt", ${pageContentHash()} AS "hash"
      FROM "page" WHERE "projectId" = ${projectId} AND "branchId" = ${main.id}`,
  );
  return { changedOnMainSinceFork: changedOnMainSinceFork(mainPages, baseline, await languageCodes(prisma, projectId)), baselineComplete: true };
};

const mainChanged = (changed: ChangedOnMainPage[]) =>
  new AppError({
    code: 'branch:main_changed',
    message: "Main has changed since this version's pages were copied from it, so the version wasn't promoted.",
    details: { reason: 'main_changed', changedOnMainSinceFork: changed },
  });

const baselineMissing = (since: Date, mainPagesEditedOrCreatedSince: number) =>
  new AppError({
    code: 'branch:baseline_missing',
    message: 'This version was created before Nibleaf could check main for changes, or copied from a version that was.',
    details: { since: since.toISOString(), mainPagesEditedOrCreatedSince },
  });

type LockedPageRow = Omit<HashedPageRow, 'hash'> & { branchId: string; hash: string | null };

/** Promote a version into the default branch ('main'): main adopts this
 *  version's pages, then the consumed version is removed. Main's prior pages
 *  are replaced, so promote refuses (409, nothing changed) unless main is
 *  exactly as it was when the version's pages were copied from it:
 *   - `branch:baseline_missing` when the version has no fork baseline;
 *   - `branch:main_changed` when a main page was modified, added or deleted.
 *
 *  Locks, in the page-write protocol order: the project row, the version row,
 *  then main's and the version's page rows in ascending id order, all FOR NO
 *  KEY UPDATE. The comparison reads those locked rows, so a save already in
 *  flight is waited for and then seen; none can land before the writes. */
export const mergeBranch = async (projectId: string, id: string) => {
  const { branch, main } = await assertPromotable(projectId, id);
  await prisma.$transaction(
    async (tx) => {
      await lockProject(tx, projectId);
      const [version] = await tx.$queryRaw<Array<{ createdAt: Date; forkedAt: Date | null; forkBaseline: Prisma.JsonValue | null }>>(
        Prisma.sql`SELECT "createdAt", "forkedAt", "forkBaseline" FROM "branch"
          WHERE "id" = ${branch.id} AND "projectId" = ${projectId} AND "isDefault" = false FOR NO KEY UPDATE`,
      );
      if (!version) throw notFound('branch', { id: branch.id });
      const rows = await tx.$queryRaw<LockedPageRow[]>(
        Prisma.sql`SELECT "id", "branchId", "title", "path", "languageId", "updatedAt",
            CASE WHEN "branchId" = ${main.id} THEN ${pageContentHash()} END AS "hash"
          FROM "page" WHERE "projectId" = ${projectId} AND "branchId" IN (${main.id}, ${branch.id})
          ORDER BY "id" ASC FOR NO KEY UPDATE`,
      );
      const baseline = parseForkBaseline(version);
      if (!baseline) {
        // A hint only: it cannot see deletions and never allows the promote.
        const since = await tx.page.count({
          where: { projectId, branchId: main.id, OR: [{ updatedAt: { gt: version.createdAt } }, { createdAt: { gt: version.createdAt } }] },
        });
        throw baselineMissing(version.createdAt, since);
      }
      const mainPages = rows.flatMap((r) => (r.branchId === main.id ? [{ ...r, hash: r.hash ?? '' }] : []));
      const changed = changedOnMainSinceFork(mainPages, baseline, await languageCodes(tx, projectId));
      if (changed.length > 0) throw mainChanged(changed);
      // Main is exactly as it was at the fork: replace its pages with this
      // branch's pages (which keep their ids + paths + remapped parent links),
      // then drop the emptied branch. One statement each, never chunks with
      // count checks: deleting a parent page cascades to its children.
      await tx.page.deleteMany({ where: { projectId, branchId: main.id } });
      await tx.page.updateMany({ where: { projectId, branchId: branch.id }, data: { branchId: main.id } });
      await tx.branch.delete({ where: { id: branch.id } });
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
