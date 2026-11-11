import { prisma } from '@nibleaf/database';
import { notFound } from '@/errors';

/**
 * The site's publish history (AUTH-13): every attempt, newest first, with who
 * published it, and per version what it changed against the published version
 * before it.
 *
 * Snapshots can be several MB on a large site, so neither read ever returns
 * one. The list never touches the `snapshot` column; the change summary
 * extracts small per-page facts (id, title, path, a digest) in SQL and returns
 * at most {@link HISTORY_CHANGES_LIMIT} of them, with totals.
 */

export const HISTORY_PAGE_SIZE = 20;
/** The most changed pages one version's summary lists; totals still count all. */
export const HISTORY_CHANGES_LIMIT = 200;

type DeploymentStatus = 'PENDING' | 'BUILDING' | 'READY' | 'FAILED';

export interface PublishHistoryItem {
  id: string;
  version: number;
  status: DeploymentStatus;
  pagesCount: number;
  commitMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  /** The publisher's display name, or null when unknown (an automatic publish, a deleted account). */
  publishedBy: string | null;
}

/** The newest READY publish: what readers see now. */
export interface LiveVersion {
  id: string;
  version: number;
}

export interface PublishHistoryPage {
  items: PublishHistoryItem[];
  /** Pass back as `cursor` for the next, older page; null on the last one. */
  nextCursor: number | null;
  live: LiveVersion | null;
}

export interface PublishChange {
  id: string;
  title: string;
  path: string;
  languageCode: string;
  kind: 'PAGE' | 'GROUP';
  status: 'added' | 'modified' | 'removed';
}

export interface PublishChangeSummary {
  /** The READY version compared against; null for the first publish (every page is new). */
  previous: LiveVersion | null;
  totals: { added: number; modified: number; removed: number };
  /** The first {@link HISTORY_CHANGES_LIMIT} changes: new, then edited, then removed, by language and path. */
  changes: PublishChange[];
  truncated: boolean;
  /** Site-wide settings (name, theme, navigation, languages, versions) or the API reference changed. */
  settingsChanged: boolean;
}

export interface PublishHistoryDetail {
  deployment: PublishHistoryItem & { error: string | null; errorDetails: unknown };
  live: LiveVersion | null;
  /** Only a READY version has a snapshot to compare; null otherwise. */
  summary: PublishChangeSummary | null;
}

type ItemRow = Omit<PublishHistoryItem, 'createdAt' | 'completedAt'> & { createdAt: Date; completedAt: Date | null };

const toItem = ({ createdAt, completedAt, ...row }: ItemRow): PublishHistoryItem => ({
  ...row,
  createdAt: createdAt.toISOString(),
  completedAt: completedAt?.toISOString() ?? null,
});

/** The newest READY version, by the (projectId, status, …) index. */
export const getLiveVersion = async (projectId: string): Promise<LiveVersion | null> =>
  prisma.deployment.findFirst({
    where: { projectId, status: 'READY' },
    orderBy: { version: 'desc' },
    select: { id: true, version: true },
  });

/**
 * One page of the history, newest first. The cursor is a version number:
 * versions are unique per site and only grow, so a publish that lands while
 * someone pages back never shifts or repeats a row.
 */
export const listPublishHistory = async (projectId: string, cursor?: number): Promise<PublishHistoryPage> => {
  const before = cursor ?? 2_147_483_647;
  const [rows, live] = await Promise.all([
    prisma.$queryRaw<Array<ItemRow & { pagesCount: number }>>`
      SELECT d.id, d.version, d.status::text AS status, d."pagesCount", d."commitMessage", d."createdAt", d."completedAt",
        u.name AS "publishedBy"
      FROM deployment d LEFT JOIN "user" u ON u.id = d."createdById"
      WHERE d."projectId" = ${projectId} AND d.version < ${before}
      ORDER BY d.version DESC
      LIMIT ${HISTORY_PAGE_SIZE + 1}
    `,
    getLiveVersion(projectId),
  ]);
  const items = rows.slice(0, HISTORY_PAGE_SIZE).map(toItem);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > HISTORY_PAGE_SIZE && last ? last.version : null, live };
};

type ChangeRow = PublishChange & { total: number | null; side: 'change' | 'total' | 'settings' };

/**
 * What a READY version changed against the READY version before it.
 *
 * Each snapshot is read (detoasted) once: `snapshot || '{}'` makes one
 * in-memory copy per row (the `OFFSET 0` subqueries stop the planner from
 * inlining it back into every use), and every later extraction works on that
 * copy. Its pages are unnested and reduced to a digest of the page without
 * its timestamps, so a re-save that changed nothing doesn't count, and only
 * ids, titles, paths and digests leave the scan. Settings compare a digest of
 * the snapshot's `project` and its API reference metadata (the document itself
 * is covered by `contentHash`). The listed changes stop at
 * {@link HISTORY_CHANGES_LIMIT}; totals count all of them. The PR that added
 * this (AUTH-13) has the plan on a 300-page site with ~3.6 MB snapshots.
 */
export const summarizePublishChanges = async (projectId: string, deploymentId: string): Promise<PublishChangeSummary> => {
  const [previous] = await prisma.$queryRaw<LiveVersion[]>`
    SELECT p.id, p.version FROM deployment p
    JOIN deployment t ON t.id = ${deploymentId} AND t."projectId" = ${projectId}
    WHERE p."projectId" = ${projectId} AND p.status = 'READY' AND p.snapshot IS NOT NULL AND p.version < t.version
    ORDER BY p.version DESC
    LIMIT 1
  `;
  const previousId = previous?.id ?? null;
  const rows = await prisma.$queryRaw<ChangeRow[]>`
    WITH pages AS MATERIALIZED (
      SELECT d.id = ${deploymentId} AS current, x.settings, e->>'id' AS id, e->>'title' AS title, e->>'path' AS path,
        e->>'languageCode' AS "languageCode", e->>'kind' AS kind,
        md5((e - 'updatedAt' - 'createdAt')::text) AS digest
      FROM deployment d
      CROSS JOIN LATERAL (SELECT d.snapshot || '{}'::jsonb AS s OFFSET 0) snap
      CROSS JOIN LATERAL (
        SELECT md5(jsonb_build_array(
          snap.s->'project',
          CASE WHEN jsonb_typeof(snap.s->'openapi') = 'object' THEN (snap.s->'openapi') - 'document' - 'updatedAt' END
        )::text) AS settings
        OFFSET 0
      ) x
      -- A site published with no pages still yields its settings row.
      LEFT JOIN LATERAL jsonb_path_query(snap.s, '$.pages[*]') e ON true
      WHERE d."projectId" = ${projectId} AND d.id IN (${deploymentId}, ${previousId ?? deploymentId}) AND d.snapshot IS NOT NULL
    ), changes AS (
      SELECT COALESCE(c.id, p.id) AS id, COALESCE(c.title, p.title) AS title, COALESCE(c.path, p.path) AS path,
        COALESCE(c."languageCode", p."languageCode") AS "languageCode", COALESCE(c.kind, p.kind) AS kind,
        CASE WHEN p.id IS NULL THEN 'added' WHEN c.id IS NULL THEN 'removed' ELSE 'modified' END AS status
      FROM (SELECT * FROM pages WHERE current AND id IS NOT NULL) c
      FULL JOIN (SELECT * FROM pages WHERE NOT current AND id IS NOT NULL AND ${previousId !== null}) p ON p.id = c.id
      WHERE c.id IS NULL OR p.id IS NULL OR c.digest <> p.digest
    ), ranked AS (
      SELECT *, row_number() OVER (ORDER BY CASE status WHEN 'added' THEN 0 WHEN 'modified' THEN 1 ELSE 2 END, "languageCode", path, id) AS rank
      FROM changes
    )
    SELECT 'change' AS side, id, title, path, "languageCode", kind, status, NULL::int AS total
    FROM ranked WHERE rank <= ${HISTORY_CHANGES_LIMIT}
    UNION ALL
    SELECT 'total', NULL, NULL, NULL, NULL, NULL, status, count(*)::int FROM changes GROUP BY status
    UNION ALL
    SELECT 'settings', NULL, NULL, NULL, NULL, NULL,
      CASE WHEN count(DISTINCT settings) > 1 THEN 'modified' ELSE 'unchanged' END, NULL
    FROM pages WHERE ${previousId !== null}
  `;
  const totals = { added: 0, modified: 0, removed: 0 };
  const changes: PublishChange[] = [];
  let settingsChanged = false;
  for (const { side, total, ...change } of rows) {
    if (side === 'settings') settingsChanged = (change.status as string) === 'modified';
    else if (side === 'total') totals[change.status] = total ?? 0;
    else changes.push(change);
  }
  const all = totals.added + totals.modified + totals.removed;
  return { previous: previous ?? null, totals, changes, truncated: all > changes.length, settingsChanged };
};

/** One version of the site: its facts, whether it's live, and (when READY) what it changed. */
export const getPublishHistoryDetail = async (projectId: string, deploymentId: string): Promise<PublishHistoryDetail> => {
  const [[row], live] = await Promise.all([
    prisma.$queryRaw<Array<ItemRow & { error: string | null; errorDetails: unknown; hasSnapshot: boolean }>>`
      SELECT d.id, d.version, d.status::text AS status, d."pagesCount", d."commitMessage", d."createdAt", d."completedAt",
        d.error, d."errorDetails", d.snapshot IS NOT NULL AS "hasSnapshot", u.name AS "publishedBy"
      FROM deployment d LEFT JOIN "user" u ON u.id = d."createdById"
      WHERE d.id = ${deploymentId} AND d."projectId" = ${projectId}
    `,
    getLiveVersion(projectId),
  ]);
  if (!row) throw notFound('deployment', { id: deploymentId });
  const { hasSnapshot, error, errorDetails, ...item } = row;
  const summary = row.status === 'READY' && hasSnapshot ? await summarizePublishChanges(projectId, deploymentId) : null;
  return { deployment: { ...toItem(item), error, errorDetails }, live, summary };
};
