import { type AnalyticsEventEnvelope, type AnalyticsPayload, buildAnalyticsEvent, deterministicAnalyticsEventId } from '../src/events';

/** Fictional, reproducible visits. Stable ids make rerunning the demo safe. The
 * historical receivedAt is intentional: buildAnalyticsEvent bounds public clock
 * skew, whereas this dev-only generator owns both ends of its synthetic clock. */
export const demoAnalyticsEvents = (tenantId: string, projectId: string, days: number, now = new Date()): AnalyticsEventEnvelope[] => {
  const events: AnalyticsEventEnvelope[] = [];
  const pages = ['introduction', 'guides/api', 'guides/authentication', 'reference/errors'];
  for (let day = 0; day < days; day += 1) {
    for (let visit = 0; visit < 12; visit += 1) {
      const base = now.getTime() - day * 86_400_000 - 3_600_000 - visit * 120_000;
      const key = `${tenantId}/${projectId}/${new Date(base).toISOString().slice(0, 10)}/${visit}`;
      const session = `demo-${key}`;
      let ordinal = 0;
      const append = (offset: number, payload: AnalyticsPayload, userAgent = 'Mozilla/5.0 Chrome/140 Safari/537.36') => {
        const time = new Date(base + offset);
        events.push(
          buildAnalyticsEvent(
            {
              eventId: deterministicAnalyticsEventId(`${key}/${ordinal++}`),
              occurredAt: time.toISOString(),
              sessionId: session,
              consentState: 'not_required',
              payload,
            },
            {
              tenantId,
              projectId,
              siteId: projectId,
              source: 'backfill',
              receivedAt: time,
              userAgent,
              device: visit % 3 === 0 ? 'mobile' : 'desktop',
              hashSalt: 'nibleaf-fictional-demo-v1',
              privacy: { visibility: 'public', allowCampaignDimensions: false, allowRawPublicSearchQueries: true },
            },
          ),
        );
      };
      const path = pages[visit % pages.length] ?? 'introduction';
      append(0, {
        name: 'page_view',
        path,
        language: visit % 4 === 0 ? 'ar' : 'en',
        ...(visit % 3 === 0 ? { utmSource: 'chatgpt.com' } : visit % 3 === 1 ? { referrer: 'https://www.google.com/search?q=nibleaf' } : {}),
      });
      append(25_000, {
        name: 'page_engaged',
        path,
        engagementMs: visit % 4 === 0 ? 4000 : 25_000 + visit * 1000,
        scrollDepth: visit % 4 === 0 ? 15 : 80,
      });
      append(26_000, {
        name: 'web_vitals',
        path,
        lcpMs: visit % 4 === 0 ? 5000 : 1200 + visit * 100,
        inpMs: 80 + visit * 10,
        clsMilli: 30 + visit * 3,
        fcpMs: 800,
        ttfbMs: 120,
      });
      append(27_000, { name: 'feedback_submitted', path, target: 'page', feedback: visit % 4 === 0 ? 'not_helpful' : 'helpful' });
      for (const [index, query] of ['api', 'api key', visit % 4 === 0 ? 'missing integration' : 'api tokens'].entries()) {
        const searchId = deterministicAnalyticsEventId(`${key}/search/${index}`);
        const offset = 30_000 + index * 1500;
        const resultCount = visit % 4 === 0 ? 0 : 5;
        append(offset, { name: 'search_query_submitted', searchId, query });
        append(offset + 200, { name: 'search_results_returned', searchId, resultCount, latencyMs: 120 });
        if (!resultCount) append(offset + 210, { name: 'search_zero_result', searchId, resultCount: 0 });
        if (index === 2 && resultCount > 0)
          append(offset + 10_000, { name: 'search_result_clicked', searchId, path: 'guides/api', resultId: 'demo-api', resultPosition: 1 });
      }
      if (visit % 4 === 0) {
        const searchId = deterministicAnalyticsEventId(`${key}/refinement`);
        append(60_000, { name: 'search_query_submitted', searchId, query: 'authentication' });
        append(60_200, { name: 'search_results_returned', searchId, resultCount: 3 });
        append(70_000, { name: 'search_result_clicked', searchId, path: 'guides/authentication', resultPosition: 2 });
      }
      append(80_000, { name: 'navigation_clicked', path, targetPath: 'guides/api' });
      append(81_000, { name: 'page_view', path: 'guides/api' });
      append(101_000, { name: 'page_engaged', path: 'guides/api', engagementMs: 20_000, scrollDepth: 90 });
      for (const ua of ['GPTBot', 'Claude-SearchBot', 'ChatGPT-User', 'Googlebot', 'curl/8']) {
        append(110_000, { name: 'crawler_request', path, resource: 'page', statusCode: 200 }, ua);
      }
    }
  }
  return events;
};
