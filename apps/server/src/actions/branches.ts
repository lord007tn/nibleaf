import { createHash } from 'node:crypto';
import { type Branch, Prisma, prisma } from '@nibleaf/database';
import { newId } from '@nibleaf/shared/ids';
import type { CreateBranchBody } from '@nibleaf/validators';
import { AppError, conflict, notFound } from '@/errors';
import {
  buildForkBaseline,
  changedOnMainSinceFork,
  forkPointOf,
  inheritForkBaseline,
  type MergePreview,
  type PromotePageRow,
  pageContentHash,
} from './branch-fork';

/** The fork baseline is promote's bookkeeping and can be large; API responses
 *  and ordinary lookups leave it out. Only the promote read loads it. */
const publicBranch = { forkBaseline: true } as const;

/** Every branch of a project, default ('main') first. */
export const listBranches = async (projectId: string): Promise<Omit<Branch, 'forkBaseline'>[]> =>
  await prisma.branch.findMany({ where: { projectId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], omit: publicBranch });

/** The project's required default branch. Missing data is an invariant error. */
export const getDefaultBranch = async (projectId: string, db: Prisma.TransactionClient = prisma) => {
  const defaults = await db.branch.findMany({ where: { projectId, isDefault: true }, take: 2, omit: publicBranch });
  if (defaults.length !== 1 || !defaults[0]) {
    throw new Error(`Project ${projectId} must have exactly one default branch.`);
  }
  return defaults[0];
};

/** Throw unless the branch exists in the project; returns it. */
export const assertBranchInProject = async (projectId: string, id: string, db: Prisma.TransactionClient = prisma) => {
  const branch = await db.branch.findFirst({ where: { id, projectId }, omit: publicBranch });
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

/** After main's pages are replaced (a promote or a replacing import), every
 *  other version's baseline names main page ids that no longer exist. Forget
 *  them in the same transaction, so those versions get `branch:baseline_missing`
 *  instead of a list of every page as deleted. `exceptId` is the version being
 *  consumed, which is deleted anyway. */
const forgetOtherForkPoints = (tx: Prisma.TransactionClient, projectId: string, exceptId: string) =>
  tx.branch.updateMany({ where: { projectId, isDefault: false, id: { not: exceptId } }, data: { forkedAt: null, forkBaseline: Prisma.DbNull } });

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
      await forgetOtherForkPoints(tx, projectId, branch.id);
      await tx.branch.delete({ where: { id: branch.id }, select: { id: true } });
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

/** Create a branch by forking another branch's pages (the default by default).
 *  Pages are deep-copied with fresh ids and remapped parent links, so the new
 *  branch is an independent, editable copy across every language.
 *
 *  A fork of main records the fork point (`forkedAt` + a baseline of main's
 *  pages and their copies, see ./branch-fork); main's pages are read and hashed
 *  in one statement under the project lock. A fork of another version copies
 *  that version's fork time and baseline, by value, with copy ids remapped onto
 *  its own copies; a source without a baseline gives none. */
export const createBranch = async (projectId: string, body: CreateBranchBody) => {
  const name = body.name.trim();
  const clash = await prisma.branch.findFirst({ where: { projectId, name }, select: { id: true } });
  if (clash) {
    throw conflict('A branch with that name already exists.', { name });
  }
  const source = body.fromBranchId ? await assertBranchInProject(projectId, body.fromBranchId) : await getDefaultBranch(projectId);

  return prisma.$transaction(
    async (tx) => {
      // Creating the copies is a structural page write: project lock first. It
      // also keeps the baseline consistent with structural changes on main.
      await lockProject(tx, projectId);
      const forkedAt = source.isDefault ? new Date() : (source.forkedAt ?? source.createdAt);
      // One statement reads the pages AND hashes them, so a save landing between
      // two reads can't slip into the copies without being in the baseline.
      const sourcePages = await tx.$queryRaw<SourcePageRow[]>(
        Prisma.sql`SELECT "id", "parentId", "languageId", "kind"::text AS "kind", "title", "slug", "path", "icon", "description", "content", "config",
          "translationKey", "position", "hidden", "updatedAt", ${pageContentHash()} AS "hash"
        FROM "page" WHERE "projectId" = ${projectId} AND "branchId" = ${source.id} ORDER BY "position" ASC, "id" ASC`,
      );
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
            config: p.config === null ? undefined : (p.config as Prisma.InputJsonValue),
            translationKey: p.translationKey,
            position: p.position,
            hidden: p.hidden,
          })),
        });
        // Git import identities follow the copies, so a copy that is later
        // promoted keeps updating from the same repository files.
        const languageByPage = new Map(sourcePages.map((p) => [p.id, p.languageId]));
        const sources = await tx.pageGitImportSource.findMany({
          where: { pageId: { in: sourcePages.map((p) => p.id) } },
          select: { pageId: true, path: true, branchId: true },
        });
        // One path per language in the copy: a row whose stored scope went stale
        // (its page was moved here) yields to the row already scoped here.
        const copies = new Map<string, { pageId: string; languageId: string; path: string; inScope: boolean }>();
        for (const s of sources) {
          const languageId = languageByPage.get(s.pageId) as string;
          const key = JSON.stringify([languageId, s.path]);
          const inScope = s.branchId === source.id;
          if (!copies.has(key) || (inScope && !copies.get(key)?.inScope)) copies.set(key, { pageId: s.pageId, languageId, path: s.path, inScope });
        }
        if (copies.size > 0) {
          await tx.pageGitImportSource.createMany({
            data: [...copies.values()].map((s) => ({
              pageId: idMap.get(s.pageId) as string,
              projectId,
              branchId: branch.id,
              languageId: s.languageId,
              path: s.path,
            })),
          });
        }
      }
      let forkBaseline: Prisma.InputJsonObject | undefined;
      if (source.isDefault) {
        // Only the copies are hashed now; main's hashes came with the read.
        const copies = await tx.$queryRaw<{ id: string; hash: string }[]>(
          Prisma.sql`SELECT "id", ${pageContentHash()} AS "hash" FROM "page" WHERE "projectId" = ${projectId} AND "branchId" = ${branch.id}`,
        );
        const hashById = new Map([...sourcePages.map((p) => [p.id, p.hash] as const), ...copies.map((c) => [c.id, c.hash] as const)]);
        forkBaseline = buildForkBaseline(sourcePages, copyIdOf, (pageId) => hashById.get(pageId) ?? '');
      } else {
        // A fork of a version inherits its baseline, remapped onto these copies.
        const from = await tx.branch.findUniqueOrThrow({ where: { id: source.id }, select: { createdAt: true, forkedAt: true, forkBaseline: true } });
        const inherited = forkPointOf(from).baseline;
        if (inherited) forkBaseline = inheritForkBaseline(inherited, (sourcePageId) => idMap.get(sourcePageId));
      }
      if (forkBaseline) await tx.branch.update({ where: { id: branch.id }, data: { forkBaseline }, select: { id: true } });
      return branch;
    },
    { timeout: 30_000 },
  );
};

type SourcePageRow = Omit<PromotePageRow, 'createdAt'> & {
  icon: string | null;
  description: string | null;
  content: string;
  config: Prisma.JsonValue | null;
  translationKey: string | null;
  hidden: boolean;
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
  const stored = await prisma.branch.findFirst({
    where: { id: branch.id, projectId },
    select: { createdAt: true, forkedAt: true, forkBaseline: true },
  });
  const baseline = stored ? forkPointOf(stored).baseline : null;
  if (!baseline) return { changedOnMainSinceFork: [], baselineComplete: false };
  const mainPages = await prisma.$queryRaw<MainPageRow[]>(
    Prisma.sql`SELECT "id", "parentId", "title", "path", "languageId", "updatedAt", ${pageContentHash()} AS "hash"
      FROM "page" WHERE "projectId" = ${projectId} AND "branchId" = ${main.id}`,
  );
  return { changedOnMainSinceFork: changedOnMainSinceFork(mainPages, baseline, await languageCodes(prisma, projectId)), baselineComplete: true };
};

type MainPageRow = Pick<PromotePageRow, 'id' | 'parentId' | 'title' | 'path' | 'languageId' | 'updatedAt' | 'hash'>;

const mainChanged = (changed: MergePreview['changedOnMainSinceFork']) =>
  new AppError({
    code: 'branch:main_changed',
    message: "Main has changed since this version's pages were copied from it, so the version wasn't promoted.",
    details: { reason: 'main_changed', changedOnMainSinceFork: changed },
  });

const baselineMissing = (since: Date, mainPagesEditedOrCreatedSince: number) =>
  new AppError({
    code: 'branch:baseline_missing',
    message:
      "Nibleaf can't tell what changed on main since this version was made: it was created before this update, was imported, was copied from such a version, or main's pages were replaced since.",
    details: { since: since.toISOString(), mainPagesEditedOrCreatedSince },
  });

type LockedPageRow = Omit<MainPageRow, 'hash'> & { branchId: string; hash: string | null };

/** Main pages deleted per statement. Deleting a parent cascades to its
 *  children, which may sit in a later chunk, so per-chunk counts are never
 *  compared. */
const DELETE_CHUNK = 1000;

/** Promote a version into the default branch ('main'): main adopts this
 *  version's pages, then the consumed version is removed. Main's prior pages
 *  are replaced, so promote refuses (409, nothing changed) unless main is
 *  exactly as it was when the version's pages were copied from it:
 *   - `branch:baseline_missing` when the version has no fork baseline;
 *   - `branch:main_changed` when a main page was modified, added or deleted.
 *
 *  Locks, in the page-write protocol order: the project row (FOR NO KEY
 *  UPDATE), the version row (FOR UPDATE, so no page can be created in the
 *  version and then cascade-deleted with it), then main's and the version's
 *  page rows in ascending id order (FOR NO KEY UPDATE). The comparison reads
 *  those locked rows, so a save already in flight is waited for and then seen.
 *
 *  Page creation on main takes no project lock, and a child insert only needs
 *  KEY SHARE on its parent, which NO KEY UPDATE allows. So before deleting,
 *  promote upgrades the main pages it deletes to FOR UPDATE (ascending id),
 *  which blocks new children from then on, and then checks, in a fresh
 *  statement, for main pages it did not lock: any such page is listed as
 *  `added` and promote refuses. It deletes only the locked ids.
 *
 *  Known limit: a root page whose insert commits on main after that check is
 *  not deleted; it stays on main beside the promoted pages and can share a
 *  path with one of them. The `createPage` project lock from #301 removes this
 *  window. */
export const mergeBranch = async (projectId: string, id: string) => {
  const { branch, main } = await assertPromotable(projectId, id);
  await prisma.$transaction(
    async (tx) => {
      await lockProject(tx, projectId);
      const [version] = await tx.$queryRaw<Array<{ createdAt: Date; forkedAt: Date | null; forkBaseline: Prisma.JsonValue | null }>>(
        Prisma.sql`SELECT "createdAt", "forkedAt", "forkBaseline" FROM "branch"
          WHERE "id" = ${branch.id} AND "projectId" = ${projectId} AND "isDefault" = false FOR UPDATE`,
      );
      if (!version) throw notFound('branch', { id: branch.id });
      const rows = await tx.$queryRaw<LockedPageRow[]>(
        Prisma.sql`SELECT "id", "branchId", "parentId", "title", "path", "languageId", "updatedAt",
            CASE WHEN "branchId" = ${main.id} THEN ${pageContentHash()} END AS "hash"
          FROM "page" WHERE "projectId" = ${projectId} AND "branchId" IN (${main.id}, ${branch.id})
          ORDER BY "id" ASC FOR NO KEY UPDATE`,
      );
      const { baseline, forkedAt } = forkPointOf(version);
      if (!baseline) {
        // A hint only: it cannot see deletions and never allows the promote.
        const since = await tx.page.count({
          where: { projectId, branchId: main.id, OR: [{ updatedAt: { gt: forkedAt } }, { createdAt: { gt: forkedAt } }] },
        });
        throw baselineMissing(forkedAt, since);
      }
      const codes = await languageCodes(tx, projectId);
      const mainPages = rows.flatMap((r) => (r.branchId === main.id ? [{ ...r, hash: r.hash ?? '' }] : []));
      const changed = changedOnMainSinceFork(mainPages, baseline, codes);
      if (changed.length > 0) throw mainChanged(changed);

      // Every main page is deleted: upgrade their locks first, then refuse if
      // a page appeared on main that the locked read did not see.
      const mainIds = mainPages.map((p) => p.id).sort();
      if (mainIds.length > 0) {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "page" WHERE "projectId" = ${projectId} AND "id" = ANY(${mainIds}::text[]) ORDER BY "id" ASC FOR UPDATE`,
        );
      }
      const appeared = await tx.$queryRaw<Array<Omit<MainPageRow, 'hash' | 'parentId'>>>(
        Prisma.sql`SELECT "id", "title", "path", "languageId", "updatedAt" FROM "page"
          WHERE "projectId" = ${projectId} AND "branchId" = ${main.id} AND NOT ("id" = ANY(${mainIds}::text[]))`,
      );
      if (appeared.length > 0) {
        throw mainChanged(
          appeared
            .map((p) => ({
              pageId: p.id,
              title: p.title,
              path: p.path,
              languageCode: codes.get(p.languageId) ?? '',
              change: 'added' as const,
              updatedAt: p.updatedAt.toISOString(),
            }))
            .sort(
              (a, b) =>
                a.path.localeCompare(b.path, 'en') || a.languageCode.localeCompare(b.languageCode, 'en') || a.pageId.localeCompare(b.pageId, 'en'),
            ),
        );
      }

      // Main is exactly as it was at the fork: replace its (locked) pages with
      // this branch's pages (which keep their ids + paths + remapped parent
      // links), then drop the emptied branch.
      for (let i = 0; i < mainIds.length; i += DELETE_CHUNK) {
        await tx.page.deleteMany({ where: { projectId, id: { in: mainIds.slice(i, i + DELETE_CHUNK) } } });
      }
      await tx.page.updateMany({ where: { projectId, branchId: branch.id }, data: { branchId: main.id } });
      await forgetOtherForkPoints(tx, projectId, branch.id);
      await tx.branch.delete({ where: { id: branch.id }, select: { id: true } });
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
  await prisma.branch.delete({ where: { id }, select: { id: true } });
  return { id };
};
