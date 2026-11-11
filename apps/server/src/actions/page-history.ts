import { prisma } from '@nibleaf/database';
import {
  diffPageLines,
  PAGE_DIFF_MAX_BYTES,
  PAGE_REVISION_MAX_BYTES,
  type PageHistoryComparison,
  type PageHistoryEntry,
} from '@nibleaf/shared/page-history';
import type { PageHistoryQuery, PageHistorySelection } from '@nibleaf/validators';
import { badRequest, notFound } from '@/errors';
import { getPage, updatePage } from './pages';

type EntryRow = Omit<PageHistoryEntry, 'createdAt'> & { createdAt: Date };

export async function listPageHistory(projectId: string, pageId: string, query: PageHistoryQuery) {
  const page = await prisma.page.findFirst({ where: { id: pageId, projectId }, select: { id: true } });
  if (!page) throw notFound('page', { id: pageId });
  const before = query.before ? new Date(query.before) : new Date('9999-01-01');
  const beforeId = query.beforeId ?? '\uffff';
  // jsonb_path_query_first extracts only the requested page. The list never
  // transfers page content (or any full deployment snapshot) to JavaScript.
  const rows =
    query.source === 'published'
      ? await prisma.$queryRaw<EntryRow[]>`
      SELECT d.id, 'published'::text AS source, p.value->>'title' AS title,
        d."createdAt", octet_length(COALESCE(p.value->>'title', '')) + octet_length(COALESCE(p.value->>'content', '')) AS "contentBytes",
        u.name AS author, NULL::text AS reason, d.version
      FROM deployment d
      CROSS JOIN LATERAL (SELECT jsonb_path_query_first(d.snapshot, '$.pages[*] ? (@.id == $pageId)', jsonb_build_object('pageId', ${pageId}::text)) AS value) p
      LEFT JOIN "user" u ON u.id = d."createdById"
      WHERE d."projectId" = ${projectId} AND d.status = 'READY' AND p.value IS NOT NULL
        AND (d."createdAt", d.id) < (${before}, ${beforeId})
      ORDER BY d."createdAt" DESC, d.id DESC LIMIT 51
    `
      : await prisma.$queryRaw<EntryRow[]>`
      SELECT r.id, 'revision'::text AS source, r.title, r."createdAt", r."contentBytes",
        u.name AS author, r.reason, NULL::integer AS version
      FROM page_revision r LEFT JOIN "user" u ON u.id = r."userId"
      WHERE r."projectId" = ${projectId} AND r."pageId" = ${pageId}
        AND (r."createdAt", r.id) < (${before}, ${beforeId})
      ORDER BY r."createdAt" DESC, r.id DESC LIMIT 51
    `;
  const entries: PageHistoryEntry[] = rows.slice(0, 50).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  const last = entries.at(-1);
  return { entries, next: rows.length > 50 && last ? { before: last.createdAt, beforeId: last.id } : null };
}

/** Bound content in SQL as well, before it crosses the DB/JS boundary. */
async function historyContent(projectId: string, pageId: string, selection: PageHistorySelection, maxBytes: number) {
  const rows =
    selection.source === 'revision'
      ? await prisma.$queryRaw<Array<{ title: string; content: string | null }>>`
      SELECT title, CASE WHEN octet_length(content) <= ${maxBytes} THEN content ELSE NULL END AS content
      FROM page_revision WHERE id = ${selection.entryId} AND "projectId" = ${projectId} AND "pageId" = ${pageId}
    `
      : await prisma.$queryRaw<Array<{ title: string; content: string | null }>>`
      SELECT p.value->>'title' AS title,
        CASE WHEN octet_length(p.value->>'content') <= ${maxBytes} THEN p.value->>'content' ELSE NULL END AS content
      FROM deployment d
      CROSS JOIN LATERAL (SELECT jsonb_path_query_first(d.snapshot, '$.pages[*] ? (@.id == $pageId)', jsonb_build_object('pageId', ${pageId}::text)) AS value) p
      WHERE d.id = ${selection.entryId} AND d."projectId" = ${projectId} AND d.status = 'READY' AND p.value IS NOT NULL
    `;
  const row = rows[0];
  if (!row) throw notFound('page history entry', { id: selection.entryId });
  return row;
}

export async function comparePageHistory(projectId: string, pageId: string, selection: PageHistorySelection): Promise<PageHistoryComparison> {
  const [current, selected] = await Promise.all([
    prisma.$queryRaw<Array<{ title: string; content: string | null; updatedAt: Date }>>`
      SELECT title, "updatedAt", CASE WHEN octet_length(content) <= ${PAGE_DIFF_MAX_BYTES} THEN content ELSE NULL END AS content
      FROM page WHERE id = ${pageId} AND "projectId" = ${projectId}
    `,
    historyContent(projectId, pageId, selection, PAGE_DIFF_MAX_BYTES),
  ]);
  const draft = current[0];
  if (!draft) throw notFound('page', { id: pageId });
  return {
    expectedUpdatedAt: draft.updatedAt.toISOString(),
    title: { before: selected.title, after: draft.title },
    diff:
      draft.content === null || selected.content === null ? { status: 'too-large', limit: 'bytes' } : diffPageLines(selected.content, draft.content),
  };
}

export async function restorePageHistory(
  projectId: string,
  pageId: string,
  selection: PageHistorySelection & { expectedUpdatedAt: string },
  userId: string,
) {
  await getPage(projectId, pageId);
  const selected = await historyContent(projectId, pageId, selection, PAGE_REVISION_MAX_BYTES);
  if (selected.content === null) throw badRequest('This history entry is too large to restore.', { reason: 'history_snapshot_too_large' });
  return updatePage(
    projectId,
    pageId,
    {
      title: selected.title,
      content: selected.content,
      expectedUpdatedAt: selection.expectedUpdatedAt,
    },
    userId,
    { beforeRestore: true },
  );
}
