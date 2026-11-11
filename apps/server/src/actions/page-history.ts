import { isDeepStrictEqual } from 'node:util';
import { prisma } from '@nibleaf/database';
import {
  diffPageLines,
  PAGE_DIFF_MAX_BYTES,
  PAGE_REVISION_MAX_BYTES,
  type PageHistoryComparison,
  type PageHistoryEntry,
} from '@nibleaf/shared/page-history';
import type { PageHistoryQuery, PageHistorySelection, UpdatePageBody } from '@nibleaf/validators';
import { badRequest, notFound } from '@/errors';
import { getPage, updatePage } from './pages';

type EntryRow = Omit<PageHistoryEntry, 'createdAt'> & { createdAt: Date };

export async function listPageHistory(projectId: string, pageId: string, query: PageHistoryQuery) {
  const page = await prisma.page.findFirst({ where: { id: pageId, projectId }, select: { id: true } });
  if (!page) throw notFound('page', { id: pageId });
  const before = query.before ? new Date(query.before) : new Date('9999-01-01');
  const beforeId = query.beforeId ?? '\uffff';
  if (query.source === 'published') {
    // Materialize only an indexed metadata batch before reading any snapshots.
    // JSON extraction still detoasts a full snapshot, even for a missing page.
    // Missing entries consume the batch and cursor, rather than scanning onward.
    const rows = await prisma.$queryRaw<Array<EntryRow & { present: boolean }>>`
      WITH candidates AS MATERIALIZED (
        SELECT id, "createdAt", "createdById", version FROM deployment
        WHERE "projectId" = ${projectId} AND status = 'READY'
          AND ("createdAt", id) < (${before}, ${beforeId})
        ORDER BY "createdAt" DESC, id DESC LIMIT 20
      ), extracted AS MATERIALIZED (
        SELECT c.*, jsonb_path_query_first(d.snapshot, '$.pages[*] ? (@.id == $pageId)', jsonb_build_object('pageId', ${pageId}::text)) AS value
        FROM candidates c CROSS JOIN LATERAL (
          SELECT snapshot FROM deployment WHERE id = c.id LIMIT 1
        ) d
      )
      SELECT p.id, 'published'::text AS source, p.value->>'title' AS title,
        p."createdAt", octet_length(COALESCE(p.value->>'title', '')) + octet_length(COALESCE(p.value->>'content', '')) +
          octet_length(jsonb_build_object('description', p.value->'description', 'icon', p.value->'icon', 'hidden', p.value->'hidden', 'config', p.value->'config')::text) AS "contentBytes",
        u.name AS author, NULL::text AS reason, p.version, p.value IS NOT NULL AS present
      FROM extracted p LEFT JOIN "user" u ON u.id = p."createdById"
      ORDER BY p."createdAt" DESC, p.id DESC
    `;
    const entries: PageHistoryEntry[] = rows
      .filter((row) => row.present)
      .map(({ present: _, ...row }) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    const last = rows.at(-1);
    return { entries, next: rows.length === 20 && last ? { before: last.createdAt.toISOString(), beforeId: last.id } : null };
  }
  const rows = await prisma.$queryRaw<EntryRow[]>`
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

type HistorySettings = Pick<UpdatePageBody, 'description' | 'icon' | 'hidden' | 'config'>;
type HistoryContent = { title: string; content: string | null; settings: HistorySettings | null };

/** Bound content and settings in SQL before either crosses the DB/JS boundary. */
async function historyContent(projectId: string, pageId: string, selection: PageHistorySelection, maxBytes: number) {
  const rows =
    selection.source === 'revision'
      ? await prisma.$queryRaw<HistoryContent[]>`
      SELECT title,
        CASE WHEN octet_length(jsonb_build_object('description', description, 'icon', icon, 'hidden', hidden, 'config', config)::text) <= ${maxBytes}
          THEN jsonb_build_object('description', description, 'icon', icon, 'hidden', hidden, 'config', config) ELSE NULL END AS settings,
        CASE WHEN octet_length(content) <= ${maxBytes} THEN content ELSE NULL END AS content
      FROM page_revision WHERE id = ${selection.entryId} AND "projectId" = ${projectId} AND "pageId" = ${pageId}
    `
      : await prisma.$queryRaw<HistoryContent[]>`
      SELECT p.value->>'title' AS title,
        CASE WHEN octet_length(s.settings::text) <= ${maxBytes} THEN s.settings ELSE NULL END AS settings,
        CASE WHEN octet_length(p.value->>'content') <= ${maxBytes} THEN p.value->>'content' ELSE NULL END AS content
      FROM deployment d
      CROSS JOIN LATERAL (SELECT jsonb_path_query_first(d.snapshot, '$.pages[*] ? (@.id == $pageId)', jsonb_build_object('pageId', ${pageId}::text)) AS value) p
      CROSS JOIN LATERAL (SELECT
        (CASE WHEN p.value ? 'description' THEN jsonb_build_object('description', p.value->'description') ELSE '{}'::jsonb END) ||
        (CASE WHEN p.value ? 'icon' THEN jsonb_build_object('icon', p.value->'icon') ELSE '{}'::jsonb END) ||
        (CASE WHEN p.value ? 'hidden' THEN jsonb_build_object('hidden', p.value->'hidden') ELSE '{}'::jsonb END) ||
        (CASE WHEN p.value ? 'config' THEN jsonb_build_object('config', p.value->'config') ELSE '{}'::jsonb END) AS settings) s
      WHERE d.id = ${selection.entryId} AND d."projectId" = ${projectId} AND d.status = 'READY' AND p.value IS NOT NULL
    `;
  const row = rows[0];
  if (!row) throw notFound('page history entry', { id: selection.entryId });
  return row;
}

export async function comparePageHistory(projectId: string, pageId: string, selection: PageHistorySelection): Promise<PageHistoryComparison> {
  const [current, selected] = await Promise.all([
    prisma.$queryRaw<Array<HistoryContent & { updatedAt: Date }>>`
      SELECT title, "updatedAt",
        CASE WHEN octet_length(jsonb_build_object('description', description, 'icon', icon, 'hidden', hidden, 'config', config)::text) <= ${PAGE_DIFF_MAX_BYTES}
          THEN jsonb_build_object('description', description, 'icon', icon, 'hidden', hidden, 'config', config) ELSE NULL END AS settings,
        CASE WHEN octet_length(content) <= ${PAGE_DIFF_MAX_BYTES} THEN content ELSE NULL END AS content
      FROM page WHERE id = ${pageId} AND "projectId" = ${projectId}
    `,
    historyContent(projectId, pageId, selection, PAGE_DIFF_MAX_BYTES),
  ]);
  const draft = current[0];
  if (!draft) throw notFound('page', { id: pageId });
  // A legacy published page can omit settings: only values actually stored
  // there replace the current draft's settings. Include settings-only changes
  // in the bounded diff so Restore remains reviewable and enabled in the editor.
  const beforeSettings = { ...draft.settings, ...selected.settings };
  const settingsChanged = !isDeepStrictEqual(beforeSettings, draft.settings);
  const before = settingsChanged ? `${JSON.stringify(beforeSettings, null, 2)}\n\n${selected.content}` : selected.content;
  const after = settingsChanged ? `${JSON.stringify(draft.settings, null, 2)}\n\n${draft.content}` : draft.content;
  return {
    expectedUpdatedAt: draft.updatedAt.toISOString(),
    title: { before: selected.title, after: draft.title },
    diff:
      draft.content === null || selected.content === null || draft.settings === null || selected.settings === null
        ? { status: 'too-large', limit: 'bytes' }
        : diffPageLines(before ?? '', after ?? ''),
  };
}

export async function restorePageHistory(
  projectId: string,
  pageId: string,
  selection: PageHistorySelection & { expectedUpdatedAt: string },
  userId: string,
) {
  const current = await getPage(projectId, pageId);
  const selected = await historyContent(projectId, pageId, selection, PAGE_REVISION_MAX_BYTES);
  if (selected.content === null || selected.settings === null)
    throw badRequest('This history entry is too large to restore.', { reason: 'history_snapshot_too_large' });
  const settings = { description: current.description, icon: current.icon, hidden: current.hidden, config: current.config, ...selected.settings };
  if (Buffer.byteLength(selected.title) + Buffer.byteLength(selected.content) + Buffer.byteLength(JSON.stringify(settings)) > PAGE_REVISION_MAX_BYTES)
    throw badRequest('This history entry is too large to restore.', { reason: 'history_snapshot_too_large' });
  return updatePage(
    projectId,
    pageId,
    {
      ...selected.settings,
      title: selected.title,
      content: selected.content,
      expectedUpdatedAt: selection.expectedUpdatedAt,
    },
    userId,
    { restore: true },
  );
}
