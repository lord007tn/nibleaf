import { Prisma, prisma } from '@nibleaf/database';
import { resolvePageMove } from '@nibleaf/shared/page-moves';
import type { RestorePageTrashBody } from '@nibleaf/validators';
import { z } from 'zod';
import { AppError, conflict, notFound } from '@/errors';
import { assertBranchInProject, getDefaultBranch } from './branches';
import { pageStructureRevision, recomputeProjectPaths, STRUCTURAL_UPDATE_TIMEOUT_MS, uniqueSiblingSlug } from './pages';

/**
 * Trash (AUTH-12). Deleting a page or group moves its whole subtree, with its
 * comments, audience grants and Git import sources, into one `page_trash` row
 * for 30 days instead of cascade-deleting it. Nothing that serves readers ever
 * reads that table, so a trashed page is gone from the live tree, the draft
 * snapshot, publish, search and exports the moment the delete commits.
 *
 * Since schema version 2 the payload also carries the subtree's page history
 * (`page_revision` rows, #492), trimmed oldest-first when the byte cap needs
 * it; throttle state (`page_revision_state`) is not kept.
 *
 * Restore puts the rows back with their original ids under the same project
 * and page locks a page move takes, so it serializes with every tree edit.
 * Generated redirects (#426) are never touched: deleting does not redirect the
 * old address, and restoring does not add one, even when the restored page
 * needs a new address because another page took its old one.
 *
 * Git sync deletions stay hard deletes (the repository is the source of truth).
 */

export const PAGE_TRASH_RETENTION_DAYS = 30;
const RETENTION_MS = PAGE_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Bump when the payload shape changes. Restore reads every version from 1 up
 *  to this one; columns a newer version added get their defaults below.
 *  2: `revisions` and `revisionCounts` (page history, #492). */
export const PAGE_TRASH_SCHEMA_VERSION = 2;

/** The largest serialized payload one Trash row may hold. Page history is
 *  trimmed (oldest revisions first) to fit; a subtree that does not fit even
 *  with no history is refused (never hard-deleted instead): one JSONB row must
 *  stay well inside what a transaction and a restore can carry. */
export const PAGE_TRASH_MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;

const trashTooLarge = (id: string, bytes: number, limit: number) =>
  new AppError({
    code: 'page:trash_too_large',
    message: 'This section is too large to move to Trash. Delete smaller parts first, or contact support.',
    details: { id, reason: 'page_trash_too_large', bytes, limit },
  });

const IN_CHUNK = 1000;
const chunks = <T>(items: T[]) => Array.from({ length: Math.ceil(items.length / IN_CHUNK) }, (_, i) => items.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK));

const optionalDate = z.coerce.date().optional();
const jsonValue = z.unknown().optional();

/**
 * One Page row in the payload. Tenant scope (project, branch, language) is not
 * stored per row: restore takes it from the trash row, so a payload can never
 * move pages into another site. Every column a later release adds to Page must
 * get a default here (a test compares this shape with the Prisma model).
 */
export const trashedPageSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable().default(null),
  kind: z.enum(['PAGE', 'GROUP']).default('PAGE'),
  title: z.string(),
  slug: z.string().min(1),
  path: z.string().default(''),
  icon: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  content: z.string().default(''),
  config: jsonValue,
  translationKey: z.string().nullable().default(null),
  position: z.number().int().default(0),
  hidden: z.boolean().default(false),
  /** Never written to Trash: moving a page to Trash again clears the notice,
   *  and restore records its own. Listed so the drift guard covers it. */
  historyTrimmedFromTrash: jsonValue,
  createdAt: optionalDate,
  updatedAt: optionalDate,
});

export const trashedCommentSchema = z.object({
  id: z.string().min(1),
  pageId: z.string().min(1),
  userId: z.string().min(1),
  body: z.string(),
  resolved: z.boolean().default(false),
  anchor: jsonValue,
  createdAt: optionalDate,
});

export const trashedAudienceGrantSchema = z.object({
  id: z.string().min(1),
  audienceId: z.string().min(1),
  pageId: z.string().min(1),
  scopeKey: z.string().min(1),
  createdAt: optionalDate,
});

export const trashedGitImportSourceSchema = z.object({
  pageId: z.string().min(1),
  path: z.string().min(1),
  createdAt: optionalDate,
  updatedAt: optionalDate,
});

/** One `page_revision` row. `userId` is null once its author no longer exists. */
export const trashedRevisionSchema = z.object({
  id: z.string().min(1),
  pageId: z.string().min(1),
  userId: z.string().min(1).nullable().default(null),
  createdAt: z.coerce.date(),
  title: z.string(),
  content: z.string().default(''),
  description: z.string().nullable().default(null),
  icon: z.string().nullable().default(null),
  hidden: z.boolean().default(false),
  config: jsonValue,
  contentBytes: z.number().int().nonnegative().default(0),
  reason: z.enum(['autosave', 'before-restore']).default('autosave'),
});

const revisionCountSchema = z.object({ total: z.number().int().nonnegative(), kept: z.number().int().nonnegative() });

export const pageTrashPayloadSchema = z.object({
  schemaVersion: z.number().int().min(1).max(PAGE_TRASH_SCHEMA_VERSION),
  pages: z.array(trashedPageSchema).min(1),
  comments: z.array(trashedCommentSchema).default([]),
  audienceGrants: z.array(trashedAudienceGrantSchema).default([]),
  gitImportSources: z.array(trashedGitImportSourceSchema).default([]),
  /** Version 1 payloads have none. */
  revisions: z.array(trashedRevisionSchema).default([]),
  /** Per page with history: how many revisions it had and how many fit. */
  revisionCounts: z.record(z.string(), revisionCountSchema).default({}),
});
export type PageTrashPayload = z.output<typeof pageTrashPayloadSchema>;

const unrestorable = (id: string, reason: 'unsupported_version' | 'invalid_payload', details: Record<string, unknown> = {}) =>
  new AppError({
    code: 'page:trash_unrestorable',
    message:
      reason === 'unsupported_version'
        ? 'This item was moved to Trash by a newer version of Nibleaf and cannot be restored by this one.'
        : 'This item in Trash is damaged and cannot be restored.',
    details: { id, reason, ...details },
  });

/** Validate a stored payload: fill defaults for columns added since it was
 *  written, refuse what cannot be mapped, and check it is one tree. */
export const parsePageTrashPayload = (trashId: string, rootPageId: string, raw: unknown): PageTrashPayload => {
  const version = typeof raw === 'object' && raw !== null ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (typeof version === 'number' && version > PAGE_TRASH_SCHEMA_VERSION)
    throw unrestorable(trashId, 'unsupported_version', { schemaVersion: version });
  const parsed = pageTrashPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw unrestorable(trashId, 'invalid_payload', { issues: parsed.error.issues.slice(0, 5).map((issue) => issue.path.join('.')) });
  }
  const payload = parsed.data;
  const ids = new Set(payload.pages.map((page) => page.id));
  if (ids.size !== payload.pages.length || !ids.has(rootPageId)) throw unrestorable(trashId, 'invalid_payload', { issues: ['pages'] });
  // Every page but the root hangs under another page of the same subtree.
  for (const page of payload.pages) {
    if (page.id !== rootPageId && (!page.parentId || !ids.has(page.parentId)))
      throw unrestorable(trashId, 'invalid_payload', { issues: ['pages.parentId'] });
  }
  return payload;
};

const iso = (date: Date) => date.toISOString();
const json = (value: Prisma.JsonValue | null) => (value === null ? undefined : (value as Prisma.InputJsonValue));

type Tx = Prisma.TransactionClient;

const lockProjectTree = async (tx: Tx, projectId: string) => {
  await tx.$queryRaw`SELECT 1 FROM "project" WHERE id = ${projectId} FOR NO KEY UPDATE`;
  await tx.$queryRaw`SELECT 1 FROM "page" WHERE "projectId" = ${projectId} ORDER BY id FOR NO KEY UPDATE`;
};

/** Expired rows go whenever Trash is changed (delete, restore, delete forever),
 *  all of which need edit rights; reads only filter them out. No scheduled job. */
export const purgeExpiredPageTrash = (db: Tx | typeof prisma, projectId: string, now = new Date()) =>
  db.pageTrash.deleteMany({ where: { projectId, expiresAt: { lte: now } } });

/** The page and every page under it, root first, parents before children. */
const subtreeIds = (rows: ReadonlyArray<{ id: string; parentId: string | null }>, rootId: string) => {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
  }
  const order: string[] = [];
  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return order;
};

/**
 * Delete a page or group: its subtree moves to Trash in the same transaction
 * that removes it from the tree. Returns the trash row's id for Undo.
 */
interface DeletePageOptions {
  /** Overrides {@link PAGE_TRASH_MAX_PAYLOAD_BYTES} (tests). */
  maxPayloadBytes?: number;
  /** Tests only: runs between reading comments and revisions and locking their authors. */
  afterCommentsRead?: () => Promise<void>;
  /** Tests only: runs once the comment and revision authors are locked. */
  afterAuthorsLocked?: () => Promise<void>;
}

type TrashedRevision = Omit<z.input<typeof trashedRevisionSchema>, 'createdAt'> & { id: string; pageId: string; createdAt: string };
type RevisionCounts = Record<string, { total: number; kept: number }>;

/**
 * Keep the newest revisions that fit: everything else in the payload is fixed,
 * so drop the oldest revisions (across the subtree, by createdAt then id) until
 * the total fits. Each revision is serialized once; the rest of the payload is
 * measured once, with every count at its upper bound. Returns null when the
 * payload does not fit even with no history.
 */
export const fitRevisions = (
  basePayload: Record<string, unknown>,
  revisions: readonly TrashedRevision[],
  limit: number,
): { revisions: TrashedRevision[]; counts: RevisionCounts } | null => {
  const counts: RevisionCounts = {};
  for (const revision of revisions) {
    const count = counts[revision.pageId] ?? { total: 0, kept: 0 };
    count.total += 1;
    counts[revision.pageId] = count;
  }
  // `kept` never exceeds `total`, so measuring with kept = total is an upper bound.
  const upperCounts = Object.fromEntries(Object.entries(counts).map(([pageId, { total }]) => [pageId, { total, kept: total }]));
  const baseBytes = Buffer.byteLength(JSON.stringify({ ...basePayload, revisions: [], revisionCounts: upperCounts }), 'utf8');
  if (baseBytes > limit) return null;
  const newestFirst = [...revisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const kept: TrashedRevision[] = [];
  let bytes = baseBytes;
  for (const revision of newestFirst) {
    // A comma separates every revision after the first.
    const size = Buffer.byteLength(JSON.stringify(revision), 'utf8') + (kept.length > 0 ? 1 : 0);
    if (bytes + size > limit) break;
    bytes += size;
    kept.push(revision);
    const count = counts[revision.pageId];
    if (count) count.kept += 1;
  }
  kept.reverse();
  return { revisions: kept, counts };
};

/** The comment and revision authors that still exist, locked FOR SHARE until the trash write
 *  commits. A concurrent account deletion waits for that commit, and its
 *  `page_trash_erase_user` trigger then removes the copies; an account deleted
 *  before the lock is simply absent, so its comments are never copied. */
const lockLiveAuthors = async (tx: Tx, userIds: string[]): Promise<Set<string>> => {
  const live = new Set<string>();
  // Sorted, so concurrent trash writes take the locks in one order.
  for (const chunk of chunks([...userIds].sort())) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "user" WHERE id IN (${Prisma.join(chunk)}) ORDER BY id FOR SHARE`;
    for (const row of rows) live.add(row.id);
  }
  return live;
};

export const deletePage = async (projectId: string, id: string, deletedById?: string | null, options: DeletePageOptions = {}) =>
  prisma.$transaction(
    async (tx) => {
      await lockProjectTree(tx, projectId);
      await purgeExpiredPageTrash(tx, projectId);
      const root = await tx.page.findFirst({ where: { id, projectId } });
      if (!root) throw notFound('page', { id });
      const tree = await tx.page.findMany({ where: { projectId, branchId: root.branchId }, select: { id: true, parentId: true } });
      const ids = subtreeIds(tree, id);
      const pages = (await Promise.all(chunks(ids).map((chunk) => tx.page.findMany({ where: { projectId, id: { in: chunk } } })))).flat();
      const order = new Map(ids.map((pageId, index) => [pageId, index]));
      pages.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      const [comments, audienceGrants, gitImportSources, revisions] = await Promise.all([
        Promise.all(chunks(ids).map((chunk) => tx.comment.findMany({ where: { projectId, pageId: { in: chunk } } }))).then((rows) => rows.flat()),
        Promise.all(chunks(ids).map((chunk) => tx.audienceGrant.findMany({ where: { projectId, pageId: { in: chunk } } }))).then((rows) =>
          rows.flat(),
        ),
        Promise.all(chunks(ids).map((chunk) => tx.pageGitImportSource.findMany({ where: { projectId, pageId: { in: chunk } } }))).then((rows) =>
          rows.flat(),
        ),
        Promise.all(
          chunks(ids).map((chunk) =>
            tx.pageRevision.findMany({ where: { projectId, pageId: { in: chunk } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
          ),
        ).then((rows) => rows.flat()),
      ]);
      await options.afterCommentsRead?.();
      const authors = new Set(comments.map((comment) => comment.userId));
      for (const revision of revisions) if (revision.userId) authors.add(revision.userId);
      const liveAuthors = await lockLiveAuthors(tx, [...authors]);
      await options.afterAuthorsLocked?.();
      const basePayload = {
        schemaVersion: PAGE_TRASH_SCHEMA_VERSION,
        pages: pages.map((page) => ({
          id: page.id,
          parentId: page.parentId,
          kind: page.kind,
          title: page.title,
          slug: page.slug,
          path: page.path,
          icon: page.icon,
          description: page.description,
          content: page.content,
          config: page.config,
          translationKey: page.translationKey,
          position: page.position,
          hidden: page.hidden,
          createdAt: iso(page.createdAt),
          updatedAt: iso(page.updatedAt),
        })),
        comments: comments.flatMap((comment) =>
          comment.pageId && liveAuthors.has(comment.userId)
            ? [
                {
                  id: comment.id,
                  pageId: comment.pageId,
                  userId: comment.userId,
                  body: comment.body,
                  resolved: comment.resolved,
                  anchor: comment.anchor,
                  createdAt: iso(comment.createdAt),
                },
              ]
            : [],
        ),
        audienceGrants: audienceGrants.flatMap((grant) =>
          grant.pageId
            ? [{ id: grant.id, audienceId: grant.audienceId, pageId: grant.pageId, scopeKey: grant.scopeKey, createdAt: iso(grant.createdAt) }]
            : [],
        ),
        gitImportSources: gitImportSources.map((source) => ({
          pageId: source.pageId,
          path: source.path,
          createdAt: iso(source.createdAt),
          updatedAt: iso(source.updatedAt),
        })),
      };
      const limit = options.maxPayloadBytes ?? PAGE_TRASH_MAX_PAYLOAD_BYTES;
      const history = fitRevisions(
        basePayload,
        revisions.map((revision) => ({
          id: revision.id,
          pageId: revision.pageId,
          // An author deleted before the fence is not carried.
          userId: revision.userId && liveAuthors.has(revision.userId) ? revision.userId : null,
          createdAt: iso(revision.createdAt),
          title: revision.title,
          content: revision.content,
          description: revision.description,
          icon: revision.icon,
          hidden: revision.hidden,
          config: revision.config,
          contentBytes: revision.contentBytes,
          // The database CHECK allows only these two values.
          reason: revision.reason === 'before-restore' ? ('before-restore' as const) : ('autosave' as const),
        })),
        limit,
      );
      if (!history) throw trashTooLarge(id, Buffer.byteLength(JSON.stringify(basePayload), 'utf8'), limit);
      const payload = { ...basePayload, revisions: history.revisions, revisionCounts: history.counts } satisfies z.input<
        typeof pageTrashPayloadSchema
      >;
      const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      if (bytes > limit) throw trashTooLarge(id, bytes, limit);
      const deletedAt = new Date();
      const trash = await tx.pageTrash.create({
        data: {
          projectId,
          branchId: root.branchId,
          languageId: root.languageId,
          rootPageId: root.id,
          parentId: root.parentId,
          position: root.position,
          title: root.title,
          kind: root.kind,
          pageCount: pages.length,
          deletedById: deletedById ?? null,
          deletedAt,
          expiresAt: new Date(deletedAt.getTime() + RETENTION_MS),
          payload: payload as unknown as Prisma.InputJsonObject,
        },
        select: { id: true, expiresAt: true, pageCount: true },
      });
      // The FK cascade removes the descendants, comments, grants, sources and
      // history (page_revision, page_revision_state).
      await tx.page.delete({ where: { id } });
      return { id, trashId: trash.id, pageCount: trash.pageCount, expiresAt: trash.expiresAt };
    },
    { timeout: STRUCTURAL_UPDATE_TIMEOUT_MS },
  );

/** How many items a branch's Trash holds, for the page tree's footer. A plain
 *  read: it never purges (expired rows are only not counted). */
export const countPageTrash = async (projectId: string, branchId?: string) => {
  const branch = branchId ? await assertBranchInProject(projectId, branchId) : await getDefaultBranch(projectId);
  const count = await prisma.pageTrash.count({ where: { projectId, branchId: branch.id, expiresAt: { gt: new Date() } } });
  return { count };
};

/** A branch's Trash, newest first, read when the Trash dialog opens. Never
 *  includes the stored content. */
export const listPageTrash = async (projectId: string, branchId?: string) => {
  const branch = branchId ? await assertBranchInProject(projectId, branchId) : await getDefaultBranch(projectId);
  const now = new Date();
  // A plain read (viewers may list): expired rows are filtered, never deleted here.
  const rows = await prisma.pageTrash.findMany({
    where: { projectId, branchId: branch.id, expiresAt: { gt: now } },
    orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      rootPageId: true,
      branchId: true,
      languageId: true,
      parentId: true,
      title: true,
      kind: true,
      pageCount: true,
      deletedAt: true,
      expiresAt: true,
      deletedBy: { select: { id: true, name: true, email: true, image: true } },
    },
  });
  return rows;
};

/** Delete forever. */
export const purgePageTrashItem = async (projectId: string, trashId: string) =>
  prisma.$transaction(async (tx) => {
    await purgeExpiredPageTrash(tx, projectId);
    const removed = await tx.pageTrash.deleteMany({ where: { id: trashId, projectId } });
    if (removed.count === 0) throw notFound('page_trash', { id: trashId });
    return { id: trashId };
  });

/**
 * Put a trashed subtree back with its original ids, under its original parent
 * when that still exists in the same branch and language, else at the top
 * level. A root address another page took meanwhile gets a suffix (`intro` →
 * `intro-2`) and the subtree's paths are recomputed.
 */
interface RestorePageTrashOptions {
  /** Tests only: runs once the comment and revision authors are locked. */
  afterAuthorsLocked?: () => Promise<void>;
}

export const restorePageTrashItem = async (
  projectId: string,
  trashId: string,
  body: RestorePageTrashBody = {},
  options: RestorePageTrashOptions = {},
) =>
  prisma.$transaction(
    async (tx) => {
      await lockProjectTree(tx, projectId);
      await purgeExpiredPageTrash(tx, projectId);
      const item = await tx.pageTrash.findFirst({ where: { id: trashId, projectId } });
      if (!item) throw notFound('page_trash', { id: trashId });
      const payload = parsePageTrashPayload(item.id, item.rootPageId, item.payload);
      const rows = await tx.page.findMany({
        where: { projectId },
        select: { id: true, parentId: true, branchId: true, languageId: true, position: true, slug: true, translationKey: true },
      });
      const branchRows = rows.filter((row) => row.branchId === item.branchId);
      if (body.expectedStructureRevision && body.expectedStructureRevision !== pageStructureRevision(branchRows)) {
        throw conflict('The page structure changed. Refresh the tree and try again.', { reason: 'structure_changed' });
      }
      const ids = new Set(payload.pages.map((page) => page.id));
      if (rows.some((row) => ids.has(row.id))) {
        throw conflict('These pages are already back in the tree.', { reason: 'trash_already_restored' });
      }
      const root = payload.pages.find((page) => page.id === item.rootPageId) as PageTrashPayload['pages'][number];
      const parent = item.parentId ? branchRows.find((row) => row.id === item.parentId && row.languageId === item.languageId) : undefined;
      const parentId = parent?.id ?? null;

      // The root's address among its new siblings.
      const siblings = branchRows
        .filter((row) => row.parentId === parentId && row.languageId === item.languageId)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      const slug = siblings.some((row) => row.slug === root.slug)
        ? await uniqueSiblingSlug(tx, projectId, item.languageId, item.branchId, parentId, root.slug)
        : root.slug;

      // Its place: where it was when its parent survived, else last. Resolved
      // like a page move, so siblings are renumbered the same way.
      const index = parent || !item.parentId ? siblings.filter((row) => row.position < item.position).length : siblings.length;
      const anchor = siblings[index];
      const placed = resolvePageMove(
        [...branchRows, { id: root.id, parentId, position: item.position, languageId: item.languageId, branchId: item.branchId }],
        { pageId: root.id, parentId, position: anchor ? { before: anchor.id } : { at: 'end' } },
      );
      if (!placed) throw conflict('The page structure changed. Refresh the tree and try again.', { reason: 'structure_changed' });
      const rootPosition = placed.find((change) => change.id === root.id)?.position ?? item.position;
      for (const change of placed) {
        if (change.id !== root.id) await tx.page.updateMany({ where: { id: change.id, projectId }, data: { position: change.position } });
      }

      // A translation link another page of this language took meanwhile stays with it.
      const takenKeys = new Set(branchRows.flatMap((row) => (row.languageId === item.languageId && row.translationKey ? [row.translationKey] : [])));
      const now = new Date();
      // History that did not fit the payload is gone; the History panel says so.
      const trimmed = (pageId: string) => {
        const count = payload.revisionCounts[pageId];
        return count && count.kept < count.total ? { kept: count.kept, total: count.total, at: iso(now) } : undefined;
      };
      await tx.page.createMany({
        data: payload.pages.map((page) => {
          const isRoot = page.id === root.id;
          return {
            id: page.id,
            projectId,
            branchId: item.branchId,
            languageId: item.languageId,
            parentId: isRoot ? parentId : page.parentId,
            kind: page.kind,
            title: page.title,
            slug: isRoot ? slug : page.slug,
            path: page.path,
            icon: page.icon,
            description: page.description,
            content: page.content,
            config: json((page.config ?? null) as Prisma.JsonValue | null),
            translationKey: page.translationKey && takenKeys.has(page.translationKey) ? null : page.translationKey,
            position: isRoot ? rootPosition : page.position,
            hidden: page.hidden,
            historyTrimmedFromTrash: trimmed(page.id),
            createdAt: page.createdAt ?? now,
            updatedAt: now,
          };
        }),
      });

      // Comments by people who have since left the platform, and grants to
      // audiences deleted since, are not brought back.
      const userIds = [
        ...new Set([
          ...payload.comments.map((comment) => comment.userId),
          ...payload.revisions.flatMap((revision) => (revision.userId ? [revision.userId] : [])),
        ]),
      ];
      // Locked like the trash write's authors: an account deleted from here on
      // waits for this restore (and its SET NULL / cascade then applies), so no
      // insert below can reference a user that is gone.
      const users = await lockLiveAuthors(tx, userIds);
      await options.afterAuthorsLocked?.();
      const comments = payload.comments.filter((comment) => ids.has(comment.pageId) && users.has(comment.userId));
      if (comments.length > 0) {
        await tx.comment.createMany({
          data: comments.map((comment) => ({
            id: comment.id,
            projectId,
            pageId: comment.pageId,
            userId: comment.userId,
            body: comment.body,
            resolved: comment.resolved,
            anchor: json((comment.anchor ?? null) as Prisma.JsonValue | null),
            createdAt: comment.createdAt ?? now,
          })),
          skipDuplicates: true,
        });
      }
      // History comes back with its ids and times; an author who has left is
      // shown as unknown, as `page_revision.userId` is SET NULL for live pages.
      for (const chunk of chunks(payload.revisions.filter((revision) => ids.has(revision.pageId)))) {
        await tx.pageRevision.createMany({
          data: chunk.map((revision) => ({
            id: revision.id,
            projectId,
            pageId: revision.pageId,
            userId: revision.userId && users.has(revision.userId) ? revision.userId : null,
            createdAt: revision.createdAt,
            title: revision.title,
            content: revision.content,
            description: revision.description,
            icon: revision.icon,
            hidden: revision.hidden,
            config: json((revision.config ?? null) as Prisma.JsonValue | null),
            contentBytes: revision.contentBytes,
            reason: revision.reason,
          })),
          skipDuplicates: true,
        });
      }
      const audienceIds = [...new Set(payload.audienceGrants.map((grant) => grant.audienceId))];
      const audiences = new Set(
        (audienceIds.length ? await tx.audience.findMany({ where: { projectId, id: { in: audienceIds } }, select: { id: true } }) : []).map(
          (audience) => audience.id,
        ),
      );
      const grants = payload.audienceGrants.filter((grant) => ids.has(grant.pageId) && audiences.has(grant.audienceId));
      if (grants.length > 0) {
        await tx.audienceGrant.createMany({
          data: grants.map((grant) => ({
            id: grant.id,
            projectId,
            audienceId: grant.audienceId,
            pageId: grant.pageId,
            scopeKey: grant.scopeKey,
            createdAt: grant.createdAt ?? now,
          })),
          skipDuplicates: true,
        });
      }
      const sources = payload.gitImportSources.filter((source) => ids.has(source.pageId));
      if (sources.length > 0) {
        // A file another page was imported from since keeps that page.
        await tx.pageGitImportSource.createMany({
          data: sources.map((source) => ({
            pageId: source.pageId,
            projectId,
            branchId: item.branchId,
            languageId: item.languageId,
            path: source.path,
            createdAt: source.createdAt ?? now,
            updatedAt: source.updatedAt ?? now,
          })),
          skipDuplicates: true,
        });
      }

      await tx.pageTrash.delete({ where: { id: item.id } });
      // Paths only: restoring never adds or rewrites a redirect.
      await recomputeProjectPaths(projectId, tx);
      const page = await tx.page.findFirstOrThrow({ where: { id: root.id, projectId } });
      return {
        page,
        restoredPages: payload.pages.length,
        slugChanged: slug !== root.slug,
        movedToTopLevel: Boolean(item.parentId) && !parent,
      };
    },
    { timeout: STRUCTURAL_UPDATE_TIMEOUT_MS },
  );
