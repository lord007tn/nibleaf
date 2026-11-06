import { getClickHouseClient, keys } from '@nibleaf/clickhouse';
import { Prisma, prisma } from '@nibleaf/database';
import type { ProjectConfig } from '@nibleaf/validators';
import { AppError } from '@/errors';
import { resolveSupportRange, type SupportRange } from './support-range';
import type { McpPrincipal } from './types';

export type InvestigationKind = 'get_top_pages' | 'get_top_searches' | 'get_failed_searches' | 'get_page_feedback' | 'get_referrers';
type Row = {
  key: string;
  count: string | number | bigint;
  visitors?: string | number;
  helpful?: string | number | bigint;
  unhelpful?: string | number | bigint;
  lastSeen?: string | Date;
  zeroResults?: string | number;
  clicks?: string | number;
};
const number = (value: Row['count'] | undefined) => Number(value ?? 0);
export const redactSearchTerm = (term: string) =>
  term
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[phone]')
    .replace(/\d{6,}/g, '[digits]')
    .slice(0, 200);
const aiDomains = [
  'chatgpt.com',
  'chat.openai.com',
  'perplexity.ai',
  'claude.ai',
  'gemini.google.com',
  'copilot.microsoft.com',
  'you.com',
  'phind.com',
  'poe.com',
  'chat.deepseek.com',
  'meta.ai',
  'grok.com',
  'chat.mistral.ai',
];
const searchDomains = ['google.com', 'bing.com', 'duckduckgo.com', 'search.yahoo.com', 'baidu.com', 'yandex.com'];
const socialDomains = ['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'reddit.com', 't.co', 'youtube.com'];
const classes = ['ai_assistant', 'search_engine', 'social', 'other'] as const;
const domainOf = (value: string) => {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const classify = (domain: string) => {
  const matches = (domains: string[]) => domains.some((base) => domain === base || domain.endsWith(`.${base}`));
  if (matches(aiDomains)) return 'ai_assistant';
  if (matches(searchDomains)) return 'search_engine';
  if (matches(socialDomains)) return 'social';
  return 'other';
};

export const getSupportAnalytics = async (principal: McpPrincipal, kind: InvestigationKind, input: SupportRange) => {
  const { id: projectId, organizationId: tenantId } = principal.project;
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: tenantId }, select: { config: true } });
  if (!project) throw new AppError({ code: 'database:not_found', message: 'Project not found.' });
  const range = resolveSupportRange(input);
  // Match the existing overview: shadow_read keeps relational results authoritative.
  const source = keys().ANALYTICS_MODE === 'clickhouse' ? 'clickhouse' : 'relational';
  const termsEnabled = (project.config as ProjectConfig | null)?.analytics?.storePublicSearchTerms === true;
  const searches = kind === 'get_top_searches' || kind === 'get_failed_searches';
  let rows: Row[] = [];
  let totals: Row[] = [];
  const reasons: string[] = [];
  if (source === 'clickhouse') {
    const client = getClickHouseClient('reader');
    const params = {
      tenant: tenantId,
      project: projectId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      language: range.language ?? '',
    };
    const common = `e.tenant_id = {tenant:String} AND e.project_id = {project:String}
      AND (e.tenant_id, e.project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
      AND e.occurred_at >= parseDateTime64BestEffort({from:String}) AND e.occurred_at <= parseDateTime64BestEffort({to:String})
      AND ({language:String} = '' OR e.language = {language:String})`;
    const query = async (sql: string) => (await client.query({ query: sql, query_params: params, format: 'JSONEachRow' })).json<Row>();
    if (searches) {
      totals = await query(
        `SELECT countIf(event_name = 'search_query_submitted') AS count, countIf(event_name = 'search_zero_result') AS zeroResults, countIf(event_name = 'search_result_clicked') AS clicks FROM analytics_events AS e FINAL WHERE ${common} LIMIT 1`,
      );
      if (termsEnabled)
        rows = await query(`SELECT s.query_text AS key, countIf(e.event_name = 'search_query_submitted') AS count,
        countIf(e.event_name = 'search_zero_result') AS zeroResults, countIf(e.event_name = 'search_result_clicked') AS clicks,
        ${kind === 'get_failed_searches' ? "maxIf(e.occurred_at, e.event_name = 'search_zero_result')" : 'max(e.occurred_at)'} AS lastSeen FROM analytics_events AS e FINAL
        INNER JOIN analytics_sensitive_queries AS s FINAL ON e.event_id = s.event_id AND e.tenant_id = s.tenant_id AND e.project_id = s.project_id
        WHERE ${common} AND e.event_name IN ('search_query_submitted', 'search_zero_result', 'search_result_clicked')
        GROUP BY s.query_text ${kind === 'get_failed_searches' ? 'HAVING zeroResults > 0' : ''} ORDER BY ${kind === 'get_failed_searches' ? 'zeroResults' : 'count'} DESC, key ASC LIMIT 50`);
      reasons.push(
        'Term rows cover only retained, opted-in events with stored query text. Click events cannot be correlated reliably to individual submitted searches; click-through and no-click counts are unavailable.',
      );
    } else if (kind === 'get_top_pages') {
      rows = await query(
        `SELECT path AS key, count() AS count, uniqExactIf(session_hash, session_hash IS NOT NULL) AS visitors FROM analytics_events AS e FINAL WHERE ${common} AND event_name = 'page_view' GROUP BY path ORDER BY count DESC, key ASC LIMIT 50`,
      );
    } else if (kind === 'get_page_feedback') {
      rows = await query(
        `SELECT path AS key, count() AS count, countIf(feedback = 'helpful') AS helpful, countIf(feedback = 'not_helpful') AS unhelpful FROM analytics_events AS e FINAL WHERE ${common} AND event_name = 'feedback_submitted' AND feedback_target = 'page' AND feedback IN ('helpful', 'not_helpful') GROUP BY path ORDER BY helpful / (helpful + unhelpful) ASC, count DESC, key ASC LIMIT 50`,
      );
    } else {
      // Domain aggregation stays server side; only the top 50 domains leave storage.
      rows = await query(
        `SELECT referrer_domain AS key, count() AS count FROM analytics_events AS e FINAL WHERE ${common} AND event_name = 'page_view' GROUP BY key ORDER BY count DESC, key ASC LIMIT 50`,
      );
      // Full class totals are computed independently of the bounded domain list.
      for (const category of classes) {
        const domains = category === 'ai_assistant' ? aiDomains : category === 'search_engine' ? searchDomains : socialDomains;
        if (category === 'other') continue;
        const result = await client.query({
          query: `SELECT {category:String} AS key, count() AS count FROM analytics_events AS e FINAL WHERE ${common} AND event_name = 'page_view' AND arrayExists(d -> lower(referrer_domain) = d OR endsWith(lower(referrer_domain), concat('.', d)), {domains:Array(String)}) LIMIT 1`,
          query_params: { ...params, category, domains },
          format: 'JSONEachRow',
        });
        totals.push(...(await result.json<Row>()));
      }
      const all = await query(`SELECT count() AS count FROM analytics_events AS e FINAL WHERE ${common} AND event_name = 'page_view' LIMIT 1`);
      totals.push({ key: 'other', count: number(all[0]?.count) - totals.reduce((sum, row) => sum + number(row.count), 0) });
    }
  } else {
    const common = Prisma.sql`a."projectId" = ${projectId} AND EXISTS (SELECT 1 FROM project p WHERE p.id = a."projectId" AND p."organizationId" = ${tenantId}) AND a."createdAt" >= ${range.from} AND a."createdAt" <= ${range.to} AND (${range.language ?? ''} = '' OR a.language = ${range.language ?? ''})`;
    if (searches) {
      totals = await prisma.$queryRaw<Row[]>(Prisma.sql`SELECT count(*) AS count FROM analytics_event a WHERE ${common} AND type = 'search' LIMIT 1`);
      if (termsEnabled && kind === 'get_top_searches')
        rows = await prisma.$queryRaw<Row[]>(
          Prisma.sql`SELECT query AS key, count(*) AS count, max("createdAt") AS "lastSeen" FROM analytics_event a WHERE ${common} AND type = 'search' AND query IS NOT NULL GROUP BY query ORDER BY count DESC, key ASC LIMIT 50`,
        );
      reasons.push(
        'Relational analytics does not store result counts or search clicks; failed searches, click-through and no-click counts are unavailable. Current relational writes do not retain search terms; term rows may contain legacy data only.',
      );
    } else if (kind === 'get_top_pages')
      rows = await prisma.$queryRaw<Row[]>(
        Prisma.sql`SELECT path AS key, count(*) AS count, count(DISTINCT "sessionId") AS visitors FROM analytics_event a WHERE ${common} AND type = 'pageview' GROUP BY path ORDER BY count DESC, key ASC LIMIT 50`,
      );
    else if (kind === 'get_page_feedback')
      rows = await prisma.$queryRaw<Row[]>(
        Prisma.sql`SELECT path AS key, count(*) AS count, count(*) FILTER (WHERE query = 'helpful') AS helpful, count(*) FILTER (WHERE query = 'not_helpful') AS unhelpful FROM analytics_event a WHERE ${common} AND type = 'feedback' AND query IN ('helpful', 'not_helpful') GROUP BY path ORDER BY (count(*) FILTER (WHERE query = 'helpful'))::float / count(*) ASC, count DESC, key ASC LIMIT 50`,
      );
    else {
      const domain = Prisma.sql`lower(split_part(split_part(regexp_replace(coalesce(referrer, ''), '^https?://', '', 'i'), '/', 1), ':', 1))`;
      rows = await prisma.$queryRaw<Row[]>(
        Prisma.sql`SELECT ${domain} AS key, count(*) AS count FROM analytics_event a WHERE ${common} AND type = 'pageview' GROUP BY key ORDER BY count DESC, key ASC LIMIT 50`,
      );
      const pattern = (domains: string[]) => `(^|\\.)(${domains.map((value) => value.replaceAll('.', '\\.')).join('|')})$`;
      totals = await prisma.$queryRaw<Row[]>(Prisma.sql`SELECT CASE
        WHEN ${domain} ~ ${pattern(aiDomains)} THEN 'ai_assistant'
        WHEN ${domain} ~ ${pattern(searchDomains)} THEN 'search_engine'
        WHEN ${domain} ~ ${pattern(socialDomains)} THEN 'social'
        ELSE 'other' END AS key, count(*) AS count FROM analytics_event a WHERE ${common} AND type = 'pageview' GROUP BY key LIMIT 4`);
    }
  }
  if (source === 'clickhouse')
    reasons.push('Counts cover retained raw events; expired events cannot be reconstructed for arbitrary date boundaries.');
  const base = { source, from: range.from.toISOString(), to: range.to.toISOString(), timezone: range.timezone, reasons };
  if (searches)
    return {
      ...base,
      available: kind !== 'get_failed_searches' || source === 'clickhouse',
      termsCollected: rows.length > 0,
      termsEnabled,
      hint: !termsEnabled
        ? 'An admin can enable storing public search terms in project analytics settings; collection also requires eligible public traffic and consent.'
        : rows.length === 0
          ? 'No retained search terms are available for this range.'
          : null,
      aggregates: {
        total: number(totals[0]?.count),
        zeroResults: source === 'clickhouse' ? number(totals[0]?.zeroResults) : null,
        clickedResults: source === 'clickhouse' ? number(totals[0]?.clicks) : null,
      },
      terms: rows.map((row) => ({
        term: redactSearchTerm(row.key),
        trust: 'untrusted_visitor_input',
        count: number(kind === 'get_failed_searches' ? row.zeroResults : row.count),
        zeroResults: source === 'clickhouse' ? number(row.zeroResults) : null,
        clickThrough: null,
        noClickCount: null,
        lastSeen: row.lastSeen instanceof Date ? row.lastSeen.toISOString() : (row.lastSeen ?? null),
      })),
    };
  if (kind === 'get_top_pages')
    return {
      ...base,
      pages: rows.map((row) => ({
        path: row.key,
        views: number(row.count),
        uniqueVisitors: row.visitors === undefined ? null : number(row.visitors),
      })),
      visitorMetric: 'distinct_sessions',
    };
  if (kind === 'get_page_feedback')
    return {
      ...base,
      pages: rows.map((row) => ({
        path: row.key,
        helpful: number(row.helpful),
        notHelpful: number(row.unhelpful),
        helpfulRatio: number(row.count) ? number(row.helpful) / number(row.count) : null,
      })),
      comments: { available: false, reason: 'Reader comments are not stored.' },
    };
  const referrers = rows.map((row) => ({ domain: domainOf(row.key ?? ''), category: classify(domainOf(row.key ?? '')), views: number(row.count) }));
  return {
    ...base,
    referrers,
    totals: Object.fromEntries(classes.map((category) => [category, number(totals.find((row) => row.key === category)?.count)])),
    totalsCoverage: 'all_events',
    aiCrawlers: { tracked: false, reason: 'Analytics stores no crawler user agents or dedicated llms.txt/markdown fetch events.' },
  };
};
