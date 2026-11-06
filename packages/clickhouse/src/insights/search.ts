import { type InsightsReader, ratio, SEARCH_TERM_VISIBILITY_THRESHOLD } from './reader';
import type { SearchInsights, SearchTermRow } from './types';

/** Request ids join the three server facts and result clicks. Window lookahead
 * crosses the requested boundary, so a typeahead at 23:59:59 isn't counted just
 * because its final query is in the next bucket. Missing sessions are isolated,
 * never treated as one shared visit. Recently issued searches remain pending. */
const searchFacts = () => `WITH source AS (
  SELECT * FROM analytics_events FINAL WHERE tenant_id = {tenant:String} AND project_id = {project:String}
    AND actor_type = 'human' AND event_name LIKE 'search_%'
    AND occurred_at >= parseDateTime64BestEffort({start:String}) - INTERVAL 120 SECOND
    AND occurred_at < parseDateTime64BestEffort({to:String}) + INTERVAL 120 SECOND
), requests AS (
  SELECT if(search_id = '', toString(event_id), search_id) AS id,
    min(occurred_at) AS requested_at, any(session_hash) AS visit,
    any(query_hash) AS term_id, argMinIf(toString(event_id), occurred_at, event_name = 'search_query_submitted') AS query_event,
    max(event_name = 'search_results_returned') AS result_known,
    max(event_name = 'search_query_submitted') AS submitted,
    max(search_id != '') AS has_id, max(result_count) AS result_count
  FROM source WHERE event_name != 'search_result_clicked' GROUP BY id HAVING submitted = 1
), sequenced AS (
  SELECT *, requested_at AS occurred_at, leadInFrame(requested_at, 1, toDateTime64('2100-01-01', 3, 'UTC')) OVER (
    PARTITION BY ifNull(visit, concat('missing-', id)) ORDER BY requested_at, id
    ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS next_request
  FROM requests
), clicks AS (
  SELECT search_id AS click_id, session_hash AS click_visit,
    min(occurred_at) AS click_at, sumIf(result_position, result_position > 0) AS position_sum, countIf(result_position > 0) AS position_count,
    argMin(path, occurred_at) AS result_path, groupArray(path) AS result_paths
  FROM analytics_events FINAL WHERE tenant_id = {tenant:String} AND project_id = {project:String} AND actor_type = 'human'
    AND occurred_at >= parseDateTime64BestEffort({start:String}) - INTERVAL 120 SECOND
    AND event_name = 'search_result_clicked' AND search_id != ''
  GROUP BY search_id, session_hash
), settled AS (
  SELECT r.*, c.click_at, c.position_sum, c.position_count, c.result_path, c.result_paths,
    c.click_id != '' AND c.click_at >= r.occurred_at AS clicked
  FROM sequenced r LEFT JOIN clicks c ON r.id = c.click_id AND r.visit = c.click_visit
  WHERE dateDiff('millisecond', r.occurred_at, r.next_request) >= 5000
    AND r.occurred_at <= now64(3) - INTERVAL 5 SECOND
), followed AS (
  SELECT *, leadInFrame(occurred_at, 1, toDateTime64('2100-01-01', 3, 'UTC')) OVER w AS next_settled,
    leadInFrame(ifNull(term_id, ''), 1, '') OVER w AS next_term
  FROM settled WINDOW w AS (PARTITION BY ifNull(visit, concat('missing-', id)) ORDER BY occurred_at, id ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING)
), searches AS (
  SELECT *, occurred_at >= parseDateTime64BestEffort({from:String}) AS current,
    visit IS NOT NULL AND next_settled <= occurred_at + INTERVAL 120 SECOND AND (NOT clicked OR click_at >= next_settled) AS refined
  FROM followed WHERE occurred_at >= parseDateTime64BestEffort({start:String}) AND occurred_at < parseDateTime64BestEffort({to:String})
)`;

interface SearchTotals {
  current: number;
  searches: number;
  visits: number;
  zeros: number;
  clicked: number;
  refined: number;
  averagePosition: number | null;
  incomplete: number;
}

export const readSearch = async (reader: InsightsReader, leadingPath?: string): Promise<SearchInsights> => {
  const cte = searchFacts();
  const termStatistics = `${cte}, term_statistics AS (SELECT
      if({show_terms:UInt8} AND uniqExact(s.visit) >= {k:UInt8} AND countIf(q.query_text != '') > 0, anyIf(q.query_text, q.query_text != ''), NULL) AS term,
      substring(ifNull(s.term_id, ''), 1, 24) AS termId, count() AS searches, uniqExact(s.visit) AS visits,
      countIf(result_known AND result_count = 0) AS zeroResultSearches,
      if(countIf(s.visit IS NULL OR NOT has_id OR NOT result_known) > 0, NULL, countIf(clicked) / count()) AS clickThroughRate,
      if(countIf(s.visit IS NULL OR NOT has_id OR NOT result_known) > 0, NULL, countIf(refined) / count()) AS refinementRate,
      sumIf(position_sum, clicked) / nullIf(sumIf(position_count, clicked), 0) AS averageClickPosition,
      nullIf(topKArrayIf(1)(result_paths, clicked)[1], '') AS topResultPath, term IS NOT NULL AS visible
      FROM searches s LEFT JOIN (SELECT event_id, query_text FROM analytics_sensitive_queries FINAL
        WHERE tenant_id = {tenant:String} AND project_id = {project:String}) q ON s.query_event = toString(q.event_id)
      WHERE current AND s.term_id IS NOT NULL GROUP BY s.term_id  )`;
  const [buckets, terms, hidden, refinements] = await Promise.all([
    reader.rows<SearchTotals & { bucket: string; summary: number }>(`${cte} SELECT current,
      ${reader.bucket} AS bucket, grouping(bucket) AS summary,
      count() AS searches, uniqExact(visit) AS visits,
      countIf(result_known AND result_count = 0) AS zeros, countIf(clicked) AS clicked, countIf(refined) AS refined,
      sumIf(position_sum, clicked) / nullIf(sumIf(position_count, clicked), 0) AS averagePosition,
      countIf(visit IS NULL OR NOT has_id OR NOT result_known) AS incomplete
      FROM searches GROUP BY GROUPING SETS ((current), (current, bucket))`),
    reader.rows<SearchTermRow & { visible: number }>(
      `${termStatistics} SELECT * FROM term_statistics WHERE visible
      ${leadingPath === undefined ? '' : "AND termId IN (SELECT substring(ifNull(term_id, ''), 1, 24) FROM searches WHERE current AND clicked AND has(result_paths, {leading_path:String}))"}
      ORDER BY searches DESC LIMIT 100`,
      { leading_path: leadingPath },
    ),
    reader.rows<{ terms: number; searches: number }>(
      `${termStatistics} SELECT countIf(NOT visible) AS terms, sumIf(searches, NOT visible) AS searches FROM term_statistics`,
    ),
    reader.rows<{ from: string; to: string; visits: number }>(`${cte}, visible AS (
      SELECT ifNull(s.term_id, '') AS id, anyIf(q.query_text, q.query_text != '') AS text FROM searches s
      LEFT JOIN (SELECT event_id, query_text FROM analytics_sensitive_queries FINAL
        WHERE tenant_id = {tenant:String} AND project_id = {project:String}) q ON s.query_event = toString(q.event_id)
      WHERE current GROUP BY s.term_id HAVING {show_terms:UInt8} AND uniqExact(s.visit) >= {k:UInt8} AND text != ''
    ) SELECT a.text AS from, b.text AS to, uniqExact(s.visit) AS visits FROM searches s
      INNER JOIN visible a ON ifNull(s.term_id, '') = a.id INNER JOIN visible b ON s.next_term = b.id
      WHERE s.current AND s.refined GROUP BY a.text, b.text ORDER BY visits DESC LIMIT 100`),
  ]);
  const totals = buckets.filter((row) => row.summary);
  const series = buckets.filter((row) => !row.summary && row.current);
  const current = totals.find((row) => row.current === 1);
  const previous = totals.find((row) => row.current === 0);
  const value = (row: SearchTotals | undefined, metric: string): number | null => {
    if (metric === 'searches') return row?.searches ?? 0;
    if (metric === 'searchVisits') return row?.visits ?? 0;
    if (!row) return null;
    if (metric === 'averageClickPosition') return row.averagePosition;
    if (row.incomplete > 0) return null;
    return ratio(metric === 'zeroResultRate' ? row.zeros : metric === 'clickThroughRate' ? row.clicked : row.refined, row.searches);
  };
  const compared = (metric: string) => ({
    value: reader.covered('current') ? value(current, metric) : null,
    previous: reader.covered('previous') ? value(previous, metric) : null,
  });
  const visible = terms.filter((row) => row.visible).map(({ visible: _visible, ...row }) => row);
  return {
    meta: reader.meta(totals.some((row) => row.incomplete > 0)),
    searchTermsVisibility: reader.scope.visibility,
    termVisibilityThreshold: SEARCH_TERM_VISIBILITY_THRESHOLD,
    kpis: {
      searches: compared('searches'),
      searchVisits: compared('searchVisits'),
      zeroResultRate: compared('zeroResultRate'),
      clickThroughRate: compared('clickThroughRate'),
      refinementRate: compared('refinementRate'),
      averageClickPosition: compared('averageClickPosition'),
    },
    searchesSeries: reader.grid(
      series.map((row) => ({ bucket: row.bucket, value: row.searches })),
      { value: 0 },
    ),
    zeroResultSeries: reader.grid(
      series.map((row) => ({ bucket: row.bucket, value: row.zeros })),
      { value: 0 },
    ),
    topTerms: visible.slice(0, 100),
    failedTerms: visible.filter((row) => row.zeroResultSearches > 0 || row.clickThroughRate === 0).slice(0, 100),
    refinements,
    hiddenTerms: hidden[0] ?? { terms: 0, searches: 0 },
  };
};

export const readSearchesLeadingHere = async (reader: InsightsReader, path: string): Promise<SearchTermRow[]> => {
  const all = await readSearch(reader, path);
  return all.topTerms;
};

export const readSearchBounces = (reader: InsightsReader) =>
  reader.rows<{ path: string; landings: number; bounces: number }>(
    `${searchFacts()} SELECT result_path AS path, countIf(clicked) AS landings,
    countIf(clicked AND click_at < next_settled AND next_settled <= occurred_at + INTERVAL 120 SECOND) AS bounces
    FROM searches WHERE current AND clicked AND result_path != '' GROUP BY result_path`,
  );
