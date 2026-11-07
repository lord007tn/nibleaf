import { createHash } from 'node:crypto';
import { type Branch, Prisma, prisma } from '@nibleaf/database';
import { newId } from '@nibleaf/shared/ids';
import { joinPath } from '@nibleaf/shared/utils';
import type { CreateBranchBody, MergeBranchBody } from '@nibleaf/validators';
import { AppError, conflict, notFound } from '@/errors';
import {
  addForkCounterparts,
  analyzePromote,
  baselineOf,
  buildForkBaseline,
  FIELD_SQL,
  inheritForkBaseline,
  type MergePreview,
  type PageFields,
  type PromotePageRow,
  pageContentHash,
  previewFingerprint,
  recordLanded,
} from './branch-fork';
import { recomputeProjectPaths } from './pages';

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

/** Throw unless the branch exists in the project; returns it (without the
 *  fork baseline). */
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

const importTransactionOptions = { isolationLevel: 'Serializable', timeout: 30_000 } as const;
const importTransactionFailure = (error: unknown): never => {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2034') throw conflict('The draft changed during import. Your edits were preserved; retry the import.');
    if (error.code === 'P2028') throw new AppError({ code: 'import:busy', message: 'The import could not complete. Try again shortly.' });
  }
  throw error;
};

/** Main's pages were replaced (they have new ids), so no other version's
 *  fork point matches them any more: clear it, and promoting one of them
 *  answers 409 branch:baseline_missing instead of reading every page as
 *  deleted on main and duplicating the tree. Skips main and the consumed
 *  version; called only once the replacement is written, never on a refusal.
 *  (A promote merges in place and keeps main's page ids, so it doesn't.) */
const forgetOtherForkPoints = (tx: Prisma.TransactionClient, projectId: string, consumedBranchId: string) =>
  tx.branch.updateMany({
    where: { projectId, isDefault: false, id: { not: consumedBranchId } },
    data: { forkBaseline: Prisma.DbNull, forkedAt: null },
  });

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
      // Replacing main's pages is a structural page write: project lock first.
      await lockProject(tx, projectId);
      if (expectedDraft !== undefined && (await draftFingerprint(tx, projectId, main.id)) !== expectedDraft) {
        throw conflict('The draft changed during import. Your edits were preserved; retry the import.');
      }
      await tx.page.deleteMany({ where: { projectId, branchId: main.id } });
      await tx.page.updateMany({ where: { projectId, branchId: branch.id }, data: { branchId: main.id } });
      await tx.branch.delete({ where: { id: branch.id }, select: { id: true } });
      // Main's pages now have new ids: no other version's fork point matches.
      await forgetOtherForkPoints(tx, projectId, branch.id);
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
 *  Every fork records a baseline (see ./branch-fork) so a later promote can
 *  merge three-way. A fork of main records main's pages; a fork of another
 *  version inherits that version's fork time and baseline, remapped onto the
 *  new copies, plus entries for the pages that version created. The source's
 *  pages, their hashes and their per-field values are read in ONE statement
 *  under the project lock, before any copy is written, so a save can't land
 *  between what is copied and what the baseline says was copied. A source
 *  without a baseline gives none, and promoting the new version is refused. */
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
      // The source may have been promoted (and removed) since it was looked up.
      const from = await tx.branch.findFirst({
        where: { id: source.id, projectId },
        select: { isDefault: true, createdAt: true, forkedAt: true, forkBaseline: true },
      });
      if (!from) throw notFound('branch', { id: source.id });
      const forkedAt = from.isDefault ? new Date() : (from.forkedAt ?? from.createdAt);
      const sourcePages = await tx.$queryRaw<SourcePageRow[]>(
        Prisma.sql`SELECT "id", "parentId", "languageId", "path", "content", "config", "position", "updatedAt", ${FIELD_SQL()}, ${pageContentHash()} AS "hash"
          FROM "page" WHERE "projectId" = ${projectId} AND "branchId" = ${source.id} ORDER BY "position" ASC, "id" ASC`,
      );
      // old page id → new page id, so parentId links can be remapped onto the copies.
      const idMap = new Map<string, string>();
      for (const p of sourcePages) {
        idMap.set(p.id, newId());
      }
      const copyIdOf = (pageId: string) => idMap.get(pageId) ?? newId();
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
      }
      // Only the copies are hashed now; the source's hashes came with its read.
      const copies = await tx.$queryRaw<{ id: string; hash: string; configHash: string }[]>(
        Prisma.sql`SELECT "id", ${pageContentHash()} AS "hash", md5(coalesce("config"::text, '')) AS "configHash"
          FROM "page" WHERE "projectId" = ${projectId} AND "branchId" = ${branch.id}`,
      );
      const copyById = new Map(copies.map((c) => [c.id, c]));
      const copyOf = (sourcePageId: string) => {
        const copyId = idMap.get(sourcePageId);
        return copyId ? copyById.get(copyId) : undefined;
      };
      let forkBaseline: Prisma.InputJsonObject | undefined;
      if (from.isDefault) {
        forkBaseline = buildForkBaseline(sourcePages, (mainPageId) => copyOf(mainPageId) ?? { id: copyIdOf(mainPageId), hash: '', configHash: '' });
      } else {
        const inherited = baselineOf(from);
        if (inherited) {
          forkBaseline = inheritForkBaseline(inherited, sourcePages, copyOf);
          // The source learns the new copies of its own pages, so promoting
          // the two in either order folds instead of duplicating.
          await tx.branch.update({
            where: { id: source.id },
            data: { forkBaseline: addForkCounterparts(inherited, sourcePages, copyOf) },
            select: { id: true },
          });
        }
      }
      if (forkBaseline) await tx.branch.update({ where: { id: branch.id }, data: { forkBaseline }, select: { id: true } });
      return branch;
    },
    { timeout: 30_000 },
  );
};

type SourcePageRow = PageFields & {
  id: string;
  parentId: string | null;
  languageId: string;
  path: string;
  content: string;
  config: Prisma.JsonValue | null;
  position: number;
  updatedAt: Date;
  hash: string;
};

type PromoteRow = PromotePageRow & { branchId: string };

const IN_CHUNK = 1000;
const chunks = <T>(items: T[]) => Array.from({ length: Math.ceil(items.length / IN_CHUNK) }, (_, i) => items.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK));

const baselineMissing = async (db: Prisma.TransactionClient, projectId: string, mainId: string, since: Date) =>
  new AppError({
    code: 'branch:baseline_missing',
    message: 'This version was created before Nibleaf could check main for changes, or copied from a version that was.',
    details: {
      since: since.toISOString(),
      // A hint only: it cannot see deletions and never allows the promote.
      mainPagesEditedOrCreatedSince: await db.page.count({
        where: { projectId, branchId: mainId, OR: [{ updatedAt: { gt: since } }, { createdAt: { gt: since } }] },
      }),
    },
  });

/** Read the version, main and the fork point for a promote, and analyze them.
 *  With `lock` (inside the promote transaction) it follows the page-write lock
 *  protocol: the project row (FOR NO KEY UPDATE), then the version row, then
 *  the page rows of BOTH branches in one ascending-id pass (FOR NO KEY UPDATE).
 *  That same locking query is the read, so no save on either side can land
 *  between it and the writes that follow; a save already in flight is waited
 *  for, then seen. The version row is locked FOR UPDATE: the protocol bans that
 *  only on project rows, and here it blocks any page insert into the version
 *  (its foreign key needs a KEY SHARE lock) until the promote ends.
 *
 *  Main-side page creates are held off by the project lock `createPage` takes
 *  from #301, which must merge first. Until then `mergeBranch` re-reads main's
 *  addresses after locking and refuses if a new page would collide.
 *
 *  Without `lock` it is a plain read (the preview). A version without a
 *  baseline returns no plan: promote refuses it. */
const readPromoteState = async (db: Prisma.TransactionClient, projectId: string, branchId: string, mainId: string, lock: boolean) => {
  if (lock) {
    await lockProject(db, projectId);
    const locked = await db.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "branch" WHERE "id" = ${branchId} AND "projectId" = ${projectId} FOR UPDATE`,
    );
    if (locked.length === 0) throw notFound('branch', { id: branchId });
  }
  const branch = await db.branch.findFirst({ where: { id: branchId, projectId }, select: { createdAt: true, forkedAt: true, forkBaseline: true } });
  if (!branch) throw notFound('branch', { id: branchId });
  const baseline = baselineOf(branch);
  if (!baseline) return { branch, analysis: null };
  const rows = await db.$queryRaw<PromoteRow[]>(
    Prisma.sql`SELECT "id", "branchId", "parentId", "path", "languageId", "position", "updatedAt", ${FIELD_SQL()}, ${pageContentHash()} AS "hash"
      FROM "page" WHERE "projectId" = ${projectId} AND "branchId" IN (${mainId}, ${branchId})
      ORDER BY "id" ASC ${lock ? Prisma.sql`FOR NO KEY UPDATE` : Prisma.empty}`,
  );
  const languages = await db.language.findMany({ where: { projectId }, select: { id: true, code: true } });
  const mainPages = rows.filter((r) => r.branchId === mainId);
  const versionPages = rows.filter((r) => r.branchId === branchId);
  const result = analyzePromote(mainPages, versionPages, baseline, new Map(languages.map((l) => [l.id, l.code])));
  return { branch, analysis: result ? { rows, ...result } : null };
};

const assertPromotable = async (projectId: string, id: string) => {
  const branch = await assertBranchInProject(projectId, id);
  if (branch.isDefault) {
    throw conflict('The default branch cannot be merged into itself.');
  }
  return { branch, main: await getDefaultBranch(projectId) };
};

/** What changed on main since this version was created (a plain read; promote
 *  repeats it under its locks). Without a baseline the list is empty and
 *  `baselineComplete` is false: promote will refuse. */
export const getMergePreview = async (projectId: string, id: string): Promise<MergePreview> => {
  const { branch, main } = await assertPromotable(projectId, id);
  const { analysis } = await readPromoteState(prisma, projectId, branch.id, main.id, false);
  return analysis?.preview ?? { changedOnMainSinceFork: [], baselineComplete: false, fingerprint: previewFingerprint([]) };
};

/** A conditional write found its row changed or gone. Nothing is committed. */
const promoteRaced = () => conflict('Pages changed while promoting. Nothing was changed; try again.', { reason: 'promote_raced' });

/** Lock the rows promote will delete FOR UPDATE, in ascending id order. That
 *  blocks anything that would hang off them meanwhile (a comment, a grant, a
 *  child page: their foreign keys need KEY SHARE), so nothing is acknowledged
 *  and then cascade-deleted. */
const lockForDelete = async (tx: Prisma.TransactionClient, projectId: string, sortedIds: string[]) => {
  for (const chunk of chunks(sortedIds)) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "page" WHERE "projectId" = ${projectId} AND "id" IN (${Prisma.join(chunk)}) ORDER BY "id" ASC FOR UPDATE`,
    );
  }
};

/** Delete locked rows by id, then check none is left. Cascades between chunks
 *  are expected (a parent's chunk takes its children with it), so per-chunk
 *  counts are not compared. */
const deleteLocked = async (tx: Prisma.TransactionClient, projectId: string, ids: string[]) => {
  for (const chunk of chunks(ids)) await tx.page.deleteMany({ where: { projectId, id: { in: chunk } } });
  for (const chunk of chunks(ids)) {
    if ((await tx.page.count({ where: { id: { in: chunk } } })) > 0) throw promoteRaced();
  }
};

/** Promote a version into the default branch ('main').
 *   - No baseline: 409 `branch:baseline_missing`, nothing changed.
 *   - A plan that would put pages inside each other: 409
 *     `branch:promote_blocked`, confirmed or not.
 *   - Pages changed on main since the fork: 409 `branch:main_changed` with the
 *     preview, unless `confirmPreview` equals the fingerprint of the preview
 *     computed here, under the locks. A preview that changed since the writer
 *     reviewed it answers 409 again, with the fresh one.
 *  Then main's pages are merged in place from the version, field by field
 *  (their ids stay stable), new version pages move in, and the version is
 *  removed; see ./branch-fork for the rules. The check and every write share
 *  one locked transaction, every update is conditional on the row it read,
 *  and every row it deletes is locked FOR UPDATE first. Only rows from the
 *  locked read are ever deleted, so a page created meanwhile is kept (or, if
 *  it would collide with an incoming page, the promote is refused). */
export const mergeBranch = async (projectId: string, id: string, body: MergeBranchBody = {}) => {
  const { branch, main } = await assertPromotable(projectId, id);
  await prisma
    .$transaction(
      async (tx) => {
        const state = await readPromoteState(tx, projectId, branch.id, main.id, true);
        if (!state.analysis) throw await baselineMissing(tx, projectId, main.id, state.branch.forkedAt ?? state.branch.createdAt);
        const { rows, preview, plan } = state.analysis;
        if (plan.blocked) {
          throw new AppError({
            code: 'branch:promote_blocked',
            message: 'Promoting would put pages inside each other. Move one of them in the version, then promote again.',
            details: { ...preview, reason: 'cycle' },
          });
        }
        if (preview.changedOnMainSinceFork.length > 0 && body.confirmPreview !== preview.fingerprint) {
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

        const consumedIds = plan.consumed.map((c) => c.copyId);
        const toDelete = [...consumedIds, ...plan.dropVersionIds, ...plan.deleteMainIds].sort();
        await lockForDelete(tx, projectId, toDelete);
        const known = new Set(rows.map((r) => r.id));
        // A page that appeared under a row we delete, after our read, would be
        // cascade-deleted with it. Now that those rows are locked none can
        // appear; refuse if one already did.
        for (const chunk of chunks(toDelete)) {
          const children = await tx.page.findMany({ where: { parentId: { in: chunk } }, select: { id: true } });
          if (children.some((c) => !known.has(c.id))) throw promoteRaced();
        }
        // A main page created after the read, at the address the promote gives
        // a version page, would end up a duplicate. The late page's own address
        // is where it lands after the promote: under its parent's final path.
        // (#301's project lock in createPage rules late pages out; this covers
        // the gap until it merges.)
        const incoming = new Set(plan.incoming.map((a) => `${a.languageId}\u0000${a.path}`));
        if (incoming.size > 0) {
          const mainNow = await tx.page.findMany({
            where: { projectId, branchId: main.id },
            select: { id: true, languageId: true, path: true, slug: true, parentId: true },
          });
          const landsAt = (p: { path: string; slug: string; parentId: string | null }) =>
            p.parentId ? joinPath(plan.finalPaths.get(p.parentId) ?? p.path.slice(0, -p.slug.length - 1), p.slug) : p.slug;
          if (mainNow.some((p) => !known.has(p.id) && incoming.has(`${p.languageId}\u0000${landsAt(p)}`))) throw promoteRaced();
        }

        const sourceIds = [...new Set(plan.mainUpdates.flatMap((u) => [u.contentFrom, u.configFrom].filter((x): x is string => Boolean(x))))];
        const sources = new Map<string, { id: string; content: string; config: Prisma.JsonValue }>();
        for (const chunk of chunks(sourceIds)) {
          const found = await tx.page.findMany({
            where: { id: { in: chunk }, projectId, branchId: branch.id },
            select: { id: true, content: true, config: true },
          });
          for (const p of found) sources.set(p.id, p);
        }
        for (const update of plan.mainUpdates) {
          const content = update.contentFrom ? sources.get(update.contentFrom) : undefined;
          const config = update.configFrom ? sources.get(update.configFrom) : undefined;
          if ((update.contentFrom && !content) || (update.configFrom && !config)) throw promoteRaced();
          const data = {
            ...update.data,
            ...(content ? { content: content.content } : {}),
            ...(config ? { config: config.config ?? Prisma.DbNull } : {}),
          };
          one((await tx.page.updateMany({ where: { ...row(update.id), projectId, branchId: main.id }, data })).count);
        }
        for (const move of plan.moves) {
          one(
            (await tx.page.updateMany({ where: { ...row(move.id), projectId, branchId: branch.id }, data: { branchId: main.id, ...move.data } }))
              .count,
          );
        }
        // Comments and reader grants on a consumed copy follow it to the main
        // page. On a dropped copy (a page deleted on main that the version left
        // untouched) and on main pages the version deleted they go with the page.
        if (consumedIds.length > 0) {
          const mainOf = new Map(plan.consumed.map((c) => [c.copyId, c.mainId]));
          for (const chunk of chunks(consumedIds)) {
            const commented = await tx.comment.groupBy({ by: ['pageId'], where: { pageId: { in: chunk } } });
            for (const { pageId } of commented) {
              const target = pageId ? mainOf.get(pageId) : undefined;
              if (pageId && target) await tx.comment.updateMany({ where: { pageId }, data: { pageId: target } });
            }
            const grants = await tx.audienceGrant.findMany({
              where: { pageId: { in: chunk } },
              select: { id: true, audienceId: true, pageId: true },
            });
            for (const grant of grants) {
              const target = grant.pageId ? mainOf.get(grant.pageId) : undefined;
              if (!target) continue;
              const scopeKey = `PAGE:${target}`;
              const existing = await tx.audienceGrant.findUnique({
                where: { audienceId_scopeKey: { audienceId: grant.audienceId, scopeKey } },
                select: { id: true },
              });
              // The main page already grants this audience: the copy's grant is a duplicate.
              if (existing) await tx.audienceGrant.delete({ where: { id: grant.id } });
              else await tx.audienceGrant.update({ where: { id: grant.id }, data: { pageId: target, scopeKey } });
            }
          }
        }
        await deleteLocked(tx, projectId, toDelete);
        // Every version page was moved, folded or dropped; anything left would
        // be lost with the version.
        if ((await tx.page.count({ where: { projectId, branchId: branch.id } })) > 0) throw promoteRaced();
        await tx.branch.delete({ where: { id: branch.id }, select: { id: true } });
        // Pages that landed on main under a new id: other versions note it, so
        // they fold into them (or, if main deletes them later, keep them
        // deleted) instead of bringing them back as new pages.
        if (plan.landed.length > 0) {
          const others = await tx.branch.findMany({
            where: { projectId, isDefault: false },
            select: { id: true, createdAt: true, forkedAt: true, forkBaseline: true },
          });
          for (const other of others) {
            const otherBaseline = baselineOf(other);
            const next = otherBaseline ? recordLanded(otherBaseline, plan.landed) : null;
            if (next) await tx.branch.update({ where: { id: other.id }, data: { forkBaseline: next }, select: { id: true } });
          }
        }
        await recomputeProjectPaths(projectId, tx);
      },
      { timeout: 60_000 },
    )
    .catch((error: unknown) => {
      // A serialization failure or a deadlock with another write: nothing was
      // committed, and trying again is safe.
      if (isRetryable(error)) throw promoteRaced();
      throw error;
    });
  return main;
};

const isRetryable = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; meta?: { code?: unknown }; cause?: { originalCode?: unknown; code?: unknown }; message?: unknown };
  if (e.code === 'P2034') return true;
  const sqlState = [e.meta?.code, e.cause?.originalCode, e.cause?.code];
  return sqlState.includes('40P01') || sqlState.includes('40001') || (typeof e.message === 'string' && /deadlock detected/i.test(e.message));
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
