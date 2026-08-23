import { createHash, createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';

export const analyticsEventNames = [
  'page_view',
  'page_engaged',
  'navigation_clicked',
  'cta_clicked',
  'outbound_link_clicked',
  'code_copied',
  'publish_started',
  'publish_completed',
  'publish_failed',
  'publish_rolled_back',
  'template_started',
  'template_completed',
  'template_failed',
  'export_started',
  'export_completed',
  'export_failed',
  'export_cancelled',
  'import_started',
  'import_completed',
  'import_failed',
  'search_query_submitted',
  'search_results_returned',
  'search_zero_result',
  'search_result_clicked',
  'answer_started',
  'answer_completed',
  'answer_failed',
  'answer_cancelled',
  'citation_shown',
  'citation_clicked',
  'feedback_submitted',
] as const;

export const analyticsEventNameSchema = z.enum(analyticsEventNames);
export type AnalyticsEventName = z.infer<typeof analyticsEventNameSchema>;

const path = z.string().trim().max(512);
const boundedDimension = z.string().trim().max(120);
const lifecyclePayload = z
  .object({
    name: z.enum([
      'publish_started',
      'publish_completed',
      'publish_failed',
      'publish_rolled_back',
      'template_started',
      'template_completed',
      'template_failed',
      'export_started',
      'export_completed',
      'export_failed',
      'export_cancelled',
      'import_started',
      'import_completed',
      'import_failed',
    ]),
    operationId: boundedDimension.optional(),
    format: z.enum(['html', 'markdown', 'pdf', 'zip']).optional(),
    sourceType: z.enum(['api', 'ghost', 'github', 'mintlify', 'template', 'ui', 'unknown']).optional(),
    outcomeReason: boundedDimension.optional(),
    itemCount: z.number().int().min(0).max(10_000_000).optional(),
    durationMs: z.number().int().min(0).max(86_400_000).optional(),
  })
  .strict();

const readerPayload = z
  .object({
    name: z.enum(['page_view', 'page_engaged', 'navigation_clicked', 'cta_clicked', 'outbound_link_clicked', 'code_copied']),
    path: path.optional(),
    targetPath: path.optional(),
    placement: boundedDimension.optional(),
    referrer: z.string().trim().max(512).optional(),
    language: z.string().trim().max(35).optional(),
    engagementMs: z.number().int().min(0).max(86_400_000).optional(),
    scrollDepth: z.number().int().min(0).max(100).optional(),
    utmSource: boundedDimension.optional(),
    utmMedium: boundedDimension.optional(),
    utmCampaign: boundedDimension.optional(),
    utmContent: boundedDimension.optional(),
    utmTerm: boundedDimension.optional(),
  })
  .strict();

const searchPayload = z
  .object({
    name: z.enum(['search_query_submitted', 'search_results_returned', 'search_zero_result', 'search_result_clicked']),
    query: z.string().trim().max(200).optional(),
    path: path.optional(),
    language: z.string().trim().max(35).optional(),
    resultCount: z.number().int().min(0).max(10_000).optional(),
    resultPosition: z.number().int().min(1).max(1000).optional(),
    resultId: boundedDimension.optional(),
    latencyMs: z.number().int().min(0).max(3_600_000).optional(),
    cacheStatus: z.enum(['bypass', 'hit', 'miss', 'stale', 'unknown']).optional(),
    noAnswerReason: z.enum(['empty_corpus', 'filtered', 'low_confidence', 'no_match', 'policy', 'provider_error', 'unknown']).optional(),
  })
  .strict();

const aiPayload = z
  .object({
    name: z.enum(['answer_started', 'answer_completed', 'answer_failed', 'answer_cancelled', 'citation_shown', 'citation_clicked']),
    provider: boundedDimension.optional(),
    model: boundedDimension.optional(),
    latencyMs: z.number().int().min(0).max(3_600_000).optional(),
    promptTokens: z.number().int().min(0).max(100_000_000).optional(),
    completionTokens: z.number().int().min(0).max(100_000_000).optional(),
    costMicros: z.number().int().min(0).max(10_000_000_000).optional(),
    cacheStatus: z.enum(['bypass', 'hit', 'miss', 'stale', 'unknown']).optional(),
    noAnswerReason: z.enum(['cancelled', 'empty_corpus', 'low_confidence', 'policy', 'provider_error', 'quota', 'unknown']).optional(),
    citationId: boundedDimension.optional(),
    citationPosition: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

const feedbackPayload = z
  .object({
    name: z.literal('feedback_submitted'),
    path: path.optional(),
    feedback: z.enum(['helpful', 'not_helpful']),
    target: z.enum(['answer', 'page', 'search']),
  })
  .strict();

export const analyticsPayloadSchema = z.discriminatedUnion('name', [readerPayload, lifecyclePayload, searchPayload, aiPayload, feedbackPayload]);
export type AnalyticsPayload = z.infer<typeof analyticsPayloadSchema>;

export const consentStateSchema = z.enum(['denied', 'granted', 'not_required', 'unknown']);
export type ConsentState = z.infer<typeof consentStateSchema>;

const analyticsEventBase = {
  eventId: z.uuid().optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  consentState: consentStateSchema.default('unknown'),
  sessionId: z.string().trim().min(1).max(128).optional(),
  anonymousUserId: z.string().trim().min(1).max(128).optional(),
};

export const analyticsEventInputSchema = z
  .object({
    ...analyticsEventBase,
    payload: analyticsPayloadSchema,
  })
  .strict();
export type AnalyticsEventInput = z.infer<typeof analyticsEventInputSchema>;

const publicSearchPayload = searchPayload.refine((payload) => payload.name === 'search_result_clicked', {
  message: 'Only result clicks may be submitted by a public client',
});

export const publicAnalyticsEventSchema = z
  .object({
    ...analyticsEventBase,
    payload: z.union([readerPayload, publicSearchPayload, feedbackPayload]),
  })
  .strict();
export type PublicAnalyticsEvent = z.infer<typeof publicAnalyticsEventSchema>;

export interface AnalyticsPrivacyPolicy {
  allowCampaignDimensions: boolean;
  allowRawPublicSearchQueries: boolean;
  visibility: 'private' | 'public';
}

export interface ServerEventContext {
  tenantId: string;
  projectId: string;
  siteId: string;
  deploymentId?: string;
  source: 'api' | 'backfill' | 'dashboard' | 'public_site' | 'system' | 'worker';
  receivedAt?: Date;
  country?: string;
  device?: string;
  privacy: AnalyticsPrivacyPolicy;
  hashSalt: string;
}

export interface AnalyticsEventEnvelope {
  eventId: string;
  schemaVersion: 1;
  occurredAt: string;
  receivedAt: string;
  tenantId: string;
  projectId: string;
  siteId: string;
  deploymentId: string | null;
  sessionHash: string | null;
  anonymousUserHash: string | null;
  source: ServerEventContext['source'];
  consentState: ConsentState;
  visibility: AnalyticsPrivacyPolicy['visibility'];
  country: string | null;
  device: string | null;
  payload: AnalyticsPayload;
  queryHash: string | null;
  queryLength: number | null;
  queryTokenCount: number | null;
  sensitiveQueryText: string | null;
}

const sha256 = (salt: string, scope: string, value: string): string => createHmac('sha256', salt).update(`${scope}:${value}`).digest('hex');

/** Stable UUID-shaped id for retryable server/worker lifecycle events. */
export const deterministicAnalyticsEventId = (scope: string): string => {
  const hex = createHash('sha256').update(scope).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16] ?? '0', 16) % 4] ?? '8';
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
};

/** Preserve ids produced by current dual writes; deterministically upgrade
 * pre-envelope relational ids so staged backfills cannot double count. */
export const analyticsBackfillEventId = (relationalId: string): string =>
  z.uuid().safeParse(relationalId).success ? relationalId : deterministicAnalyticsEventId(`postgres-analytics-event:${relationalId}`);

const cleanReferrer = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.toLowerCase().slice(0, 253);
  } catch {
    return undefined;
  }
};

const cleanPayload = (payload: AnalyticsPayload, consent: ConsentState, policy: AnalyticsPrivacyPolicy): AnalyticsPayload => {
  if ('referrer' in payload) payload.referrer = cleanReferrer(payload.referrer);
  if ('utmSource' in payload && (consent !== 'granted' || !policy.allowCampaignDimensions)) {
    delete payload.utmSource;
    delete payload.utmMedium;
    delete payload.utmCampaign;
    delete payload.utmContent;
    delete payload.utmTerm;
  }
  return payload;
};

export const buildAnalyticsEvent = (input: AnalyticsEventInput, context: ServerEventContext): AnalyticsEventEnvelope => {
  const parsed = analyticsEventInputSchema.parse(input);
  const receivedAt = context.receivedAt ?? new Date();
  const occurred = parsed.occurredAt ? new Date(parsed.occurredAt) : receivedAt;
  const maxSkewMs = 7 * 24 * 60 * 60 * 1000;
  const occurredAt = Math.abs(occurred.getTime() - receivedAt.getTime()) <= maxSkewMs ? occurred : receivedAt;
  const payload = cleanPayload(structuredClone(parsed.payload), parsed.consentState, context.privacy);
  const rawQuery = 'query' in payload ? payload.query?.trim() : undefined;
  if ('query' in payload) delete payload.query;
  const mayStoreQuery =
    Boolean(rawQuery) && context.privacy.visibility === 'public' && context.privacy.allowRawPublicSearchQueries && parsed.consentState === 'granted';
  return {
    eventId: parsed.eventId ?? randomUUID(),
    schemaVersion: 1,
    occurredAt: occurredAt.toISOString(),
    receivedAt: receivedAt.toISOString(),
    tenantId: context.tenantId,
    projectId: context.projectId,
    siteId: context.siteId,
    deploymentId: context.deploymentId ?? null,
    sessionHash: parsed.sessionId ? sha256(context.hashSalt, 'session', parsed.sessionId) : null,
    anonymousUserHash: parsed.anonymousUserId ? sha256(context.hashSalt, 'anonymous-user', parsed.anonymousUserId) : null,
    source: context.source,
    consentState: parsed.consentState,
    visibility: context.privacy.visibility,
    country: context.country?.toUpperCase().slice(0, 2) ?? null,
    device: context.device?.toLowerCase().slice(0, 32) ?? null,
    payload,
    queryHash: rawQuery ? sha256(context.hashSalt, 'query', rawQuery.toLocaleLowerCase()) : null,
    queryLength: rawQuery?.length ?? null,
    queryTokenCount: rawQuery ? rawQuery.split(/\s+/u).filter(Boolean).length : null,
    sensitiveQueryText: mayStoreQuery ? (rawQuery?.slice(0, 200) ?? null) : null,
  };
};
