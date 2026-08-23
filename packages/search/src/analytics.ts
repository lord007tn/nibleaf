/** Versioned contract consumed by the separate analytics pipeline. This package
 * defines semantics only; it deliberately does not own a ClickHouse sink. */
export const SEARCH_ANALYTICS_VERSION = 1 as const;

interface SearchAnalyticsBase {
  contractVersion: 1;
  eventId: string;
  occurredAt: string;
  projectId: string;
  deploymentId: string;
  versionSlug: string;
  language: string;
  requestId: string;
  mode: 'search' | 'answer';
  authorizationScope: 'public' | 'workspace' | 'reader';
}

export type SearchAnalyticsEventV1 =
  | (SearchAnalyticsBase & { type: 'search.query_submitted'; queryLength: number })
  | (SearchAnalyticsBase & { type: 'search.results_returned'; resultCount: number; zeroResults: boolean; cacheHit: boolean; latencyMs: number })
  | (SearchAnalyticsBase & { type: 'search.result_clicked'; pageId: string; rank: number })
  | (SearchAnalyticsBase & { type: 'answer.started'; model: string; cacheHit: boolean })
  | (SearchAnalyticsBase & {
      type: 'answer.completed';
      model: string;
      status: 'answered' | 'no_answer' | 'error' | 'cancelled';
      citationCount: number;
      latencyMs: number;
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
    })
  | (SearchAnalyticsBase & { type: 'answer.citation_clicked'; pageId: string; citationId: string })
  | (SearchAnalyticsBase & { type: 'answer.feedback'; helpful: boolean });
