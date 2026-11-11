import type { Page, Prisma } from '@nibleaf/database';
import {
  exceedsUtf8Bytes,
  PAGE_HISTORY_IDLE_MS,
  PAGE_HISTORY_INTERVAL_MS,
  PAGE_HISTORY_MAX_BYTES,
  PAGE_REVISION_MAX_BYTES,
} from '@nibleaf/shared/page-history';
import { badRequest } from '@/errors';

/** Caller holds the page row lock. Throttling, insertion, pruning and the page
 * write all commit together, including across tabs and server processes. */
export async function snapshotPage(
  tx: Prisma.TransactionClient,
  page: Page,
  next: { title: string; content: string },
  userId: string | undefined,
  beforeRestore: boolean,
): Promise<'stored' | 'unchanged' | 'throttled' | 'too-large'> {
  if (page.kind !== 'PAGE') return 'unchanged';
  const changed = next.title !== page.title || next.content !== page.content;
  if (!changed) return 'unchanged';
  const now = new Date();
  const snapshot = beforeRestore ? page : next;
  // A restore must remain undoable. Refuse it before any write when its safety
  // copy exceeds the cap; ordinary autosaves still succeed with an explicit note.
  const tooLarge =
    exceedsUtf8Bytes(snapshot.content, PAGE_REVISION_MAX_BYTES) ||
    Buffer.byteLength(snapshot.title) + Buffer.byteLength(snapshot.content) > PAGE_REVISION_MAX_BYTES;
  if (beforeRestore && tooLarge)
    throw badRequest('The current draft is too large to back up before restoring.', { reason: 'history_snapshot_too_large' });
  let due = beforeRestore;
  if (userId && !beforeRestore) {
    const state = await tx.pageRevisionState.findUnique({ where: { pageId_userId: { pageId: page.id, userId } } });
    due =
      !state ||
      now.getTime() - state.lastSavedAt.getTime() >= PAGE_HISTORY_IDLE_MS ||
      !state.lastSnapshotAt ||
      now.getTime() - state.lastSnapshotAt.getTime() >= PAGE_HISTORY_INTERVAL_MS;
    await tx.pageRevisionState.upsert({
      where: { pageId_userId: { pageId: page.id, userId } },
      create: { projectId: page.projectId, pageId: page.id, userId, lastSavedAt: now },
      update: { lastSavedAt: now },
    });
  }
  // Unattributed internal updates do not create an unthrottled history stream.
  if (tooLarge) return 'too-large';
  if (!due) return 'throttled';
  if (!beforeRestore) {
    const latest = await tx.pageRevision.findFirst({
      where: { projectId: page.projectId, pageId: page.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { title: true, content: true },
    });
    if (latest?.title === snapshot.title && latest.content === snapshot.content) return 'unchanged';
  }
  await tx.pageRevision.create({
    data: {
      projectId: page.projectId,
      pageId: page.id,
      userId: userId ?? null,
      title: snapshot.title,
      content: snapshot.content,
      contentBytes: Buffer.byteLength(snapshot.title) + Buffer.byteLength(snapshot.content),
      reason: beforeRestore ? 'before-restore' : 'autosave',
      createdAt: now,
    },
  });
  if (userId) {
    await tx.pageRevisionState.upsert({
      where: { pageId_userId: { pageId: page.id, userId } },
      create: { projectId: page.projectId, pageId: page.id, userId, lastSavedAt: now, lastSnapshotAt: now },
      update: { lastSnapshotAt: now, lastSavedAt: now },
    });
  }
  // Retain the newest 50 OR everything less than 30 days old. The hard byte
  // budget overrides both. Window sums retain a contiguous newest-first prefix,
  // so even many tiny/empty revisions never cause a JS content scan.
  await tx.$executeRaw`
    WITH ranked AS (
      SELECT id, "createdAt",
        row_number() OVER (ORDER BY "createdAt" DESC, id DESC) AS position,
        sum("contentBytes") OVER (ORDER BY "createdAt" DESC, id DESC ROWS UNBOUNDED PRECEDING) AS bytes
      FROM page_revision WHERE "projectId" = ${page.projectId} AND "pageId" = ${page.id}
    )
    DELETE FROM page_revision WHERE "projectId" = ${page.projectId} AND "pageId" = ${page.id}
      AND id IN (SELECT id FROM ranked WHERE bytes > ${PAGE_HISTORY_MAX_BYTES}
        OR (position > 50 AND "createdAt" < ${new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)}))
  `;
  return 'stored';
}
