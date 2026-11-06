import { type AiVisibilityInsights, getClickHouseClient, type InsightsAvailability, keys, type SearchInsights } from '@nibleaf/clickhouse';
import { Prisma, prisma } from '@nibleaf/database';
import type { AnalyticsInsightsQuery, ProjectConfig } from '@nibleaf/validators';
import { getAiVisibilityInsights, getSearchInsights } from '@/actions/analytics-insights';
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

const TERMS_DISABLED_HINT =
  'An admin can enable storing public search terms in project analytics settings; collection also requires eligible public traffic and consent.';
const availabilityReasons: Partial<Record<InsightsAvailability, string>> = {
  partial: 'Some events lack a visit or result record, so rates cover only the events that have them.',
  unavailable: 'The analytics store did not answer; try again later.',
  not_configured: 'ClickHouse analytics is not configured.',
};
const answered = (availability: InsightsAvailability) => availability === 'complete' || availability === 'partial';

/** The dashboard insights work in whole local days, so an MCP from/to instant
 * maps to the local date it falls on. */
const localDate = (instant: string, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const insightsQuery = (input: SupportRange): AnalyticsInsightsQuery => {
  const timezone = input.timezone ?? 'UTC';
  return input.from && input.to
    ? { range: 'custom', from: localDate(input.from, timezone), to: localDate(input.to, timezone), timezone, compare: 'none' }
    : { range: input.range ?? '30d', timezone, compare: 'none' };
};

const searchTermsHint = (insights: SearchInsights, shown: number) => {
  if (insights.searchTermsVisibility === 'disabled_by_setting') return TERMS_DISABLED_HINT;
  if (insights.searchTermsVisibility === 'private_site') return 'Search terms are never stored for private or reader-restricted sites.';
  if (shown > 0) return null;
  return insights.hiddenTerms.terms > 0
    ? `${insights.hiddenTerms.terms} terms were searched by fewer than ${insights.termVisibilityThreshold} visitors and stay hidden for privacy.`
    : 'No search terms are available for this range.';
};

/** The dashboard's search model, so the AI and the person see the same
 * numbers and the same privacy rules: settled searches (typeahead counts
 * once), a minimum number of visitors before a term's text is shown, and no
 * terms for private sites. */
const searchesFromInsights = async (tenantId: string, projectId: string, kind: 'get_top_searches' | 'get_failed_searches', input: SupportRange) => {
  const insights = await getSearchInsights(tenantId, projectId, insightsQuery(input));
  const { meta, kpis } = insights;
  const rows = (kind === 'get_failed_searches' ? insights.failedTerms : insights.topTerms)
    .flatMap((row) => (row.term === null ? [] : [{ ...row, term: row.term }]))
    .slice(0, 50);
  const availabilityReason = availabilityReasons[meta.availability];
  return {
    source: 'clickhouse' as const,
    from: meta.current.from,
    to: meta.current.to,
    timezone: meta.timezone,
    availability: meta.availability,
    reasons: [
      `Searches are settled: typeahead keystrokes count once, as the final query. A term's text is shown only when at least ${insights.termVisibilityThreshold} visitors searched it.`,
      ...(kind === 'get_failed_searches' ? ['Failed terms returned no results, or returned results that nobody clicked.'] : []),
      ...(input.language ? ['Search analytics are not split by language, so the language filter was not applied.'] : []),
      ...(availabilityReason ? [availabilityReason] : []),
    ],
    available: answered(meta.availability),
    termsEnabled: insights.searchTermsVisibility === 'visible',
    termsCollected: rows.length > 0,
    hint: searchTermsHint(insights, rows.length),
    aggregates: {
      searches: kpis.searches.value,
      zeroResultRate: kpis.zeroResultRate.value,
      clickThroughRate: kpis.clickThroughRate.value,
      refinementRate: kpis.refinementRate.value,
    },
    hiddenTerms: insights.hiddenTerms,
    terms: rows.map((row) => ({
      term: redactSearchTerm(row.term),
      trust: 'untrusted_visitor_input' as const,
      searches: row.searches,
      visitors: row.visits,
      zeroResults: row.zeroResultSearches,
      clickThrough: row.clickThroughRate,
      refinementRate: row.refinementRate,
      topResultPath: row.topResultPath,
      lastSeen: null,
    })),
  };
};

const aiCrawlerSummary = (insights: AiVisibilityInsights, languageRequested: boolean) => {
  const reason = availabilityReasons[insights.meta.availability];
  return {
    tracked: answered(insights.meta.availability),
    availability: insights.meta.availability,
    from: insights.meta.current.from,
    to: insights.meta.current.to,
    reasons: [
      'AI crawlers are counted from server responses to their requests. "assistantFetches" are pages an AI assistant fetched for a person.',
      ...(languageRequested ? ['Crawler requests are not split by language.'] : []),
      ...(reason ? [reason] : []),
    ],
    requests: insights.kpis.aiCrawlerRequests.value,
    assistantFetches: insights.kpis.aiAssistantFetches.value,
    crawledPages: insights.kpis.crawledPages.value,
    bots: insights.bots.slice(0, 10).map(({ bot, operator, category, requests, pages, lastSeenAt, verification }) => ({
      bot,
      operator,
      category,
      requests,
      pages,
      lastSeenAt,
      verification,
    })),
    topCrawledPages: insights.topCrawledPages.slice(0, 10).map(({ path, title, requests, bots }) => ({ path, title, requests, bots })),
  };
};

export const getSupportAnalytics = async (principal: McpPrincipal, kind: InvestigationKind, input: SupportRange) => {
  const { id: projectId, organizationId: tenantId } = principal.project;
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: tenantId }, select: { config: true } });
  if (!project) throw new AppError({ code: 'database:not_found', message: 'Project not found.' });
  // Match the existing overview: shadow_read keeps relational results authoritative.
  const source = keys().ANALYTICS_MODE === 'clickhouse' ? 'clickhouse' : 'relational';
  if (source === 'clickhouse' && (kind === 'get_top_searches' || kind === 'get_failed_searches'))
    return searchesFromInsights(tenantId, projectId, kind, input);
  const resolved = resolveSupportRange(input);
  // Feedback events record no language, so a language filter would silently
  // hide every row. Ignore it for feedback and say so in the response.
  const languageIgnored = kind === 'get_page_feedback' && resolved.language !== undefined;
  const range = languageIgnored ? { ...resolved, language: undefined } : resolved;
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
    // People only, as in the dashboard: crawlers and bots are reported separately.
    const common = `e.tenant_id = {tenant:String} AND e.project_id = {project:String} AND e.actor_type = 'human'
      AND (e.tenant_id, e.project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
      AND e.occurred_at >= parseDateTime64BestEffort({from:String}) AND e.occurred_at <= parseDateTime64BestEffort({to:String})
      AND ({language:String} = '' OR e.language = {language:String})`;
    const query = async (sql: string) => (await client.query({ query: sql, query_params: params, format: 'JSONEachRow' })).json<Row>();
    if (kind === 'get_top_pages') {
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
  if (languageIgnored) reasons.push('Feedback events do not record a language, so the language filter was not applied.');
  const base = { source, from: range.from.toISOString(), to: range.to.toISOString(), timezone: range.timezone, reasons };
  if (searches)
    return {
      ...base,
      availability: 'complete' as const,
      available: kind !== 'get_failed_searches',
      termsEnabled,
      termsCollected: rows.length > 0,
      hint: !termsEnabled ? TERMS_DISABLED_HINT : rows.length === 0 ? 'No retained search terms are available for this range.' : null,
      aggregates: { searches: number(totals[0]?.count), zeroResultRate: null, clickThroughRate: null, refinementRate: null },
      hiddenTerms: null,
      terms: rows.map((row) => ({
        term: redactSearchTerm(row.key),
        trust: 'untrusted_visitor_input' as const,
        searches: number(row.count),
        visitors: null,
        zeroResults: null,
        clickThrough: null,
        refinementRate: null,
        topResultPath: null,
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
    aiCrawlers:
      source === 'clickhouse'
        ? aiCrawlerSummary(await getAiVisibilityInsights(tenantId, projectId, insightsQuery(input)), range.language !== undefined)
        : { tracked: false, reasons: ['Only ClickHouse analytics records AI crawler requests.'] },
  };
};
