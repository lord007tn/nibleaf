import type { LegacyTrackAnalyticsEventJobData } from '@nibleaf/bullmq/jobs/analytics';
import {
  type AnalyticsEventEnvelope,
  type AnalyticsPayload,
  type AnalyticsPrivacyPolicy,
  buildAnalyticsEvent,
  deterministicAnalyticsEventId,
} from '@nibleaf/clickhouse';

const bounded = (value: string | null, max: number): string | undefined => {
  const normalized = value?.trim().slice(0, max);
  return normalized || undefined;
};

const legacyPayload = (data: LegacyTrackAnalyticsEventJobData): AnalyticsPayload | null => {
  const path = bounded(data.path, 512);
  const language = bounded(data.language, 35);
  if (data.type === 'pageview') {
    return {
      name: 'page_view',
      ...(path ? { path } : {}),
      ...(bounded(data.referrer, 512) ? { referrer: bounded(data.referrer, 512) } : {}),
      ...(language ? { language } : {}),
    };
  }
  if (data.type === 'search') {
    return {
      name: 'search_query_submitted',
      ...(bounded(data.query, 200) ? { query: bounded(data.query, 200) } : {}),
      ...(path ? { path } : {}),
      ...(language ? { language } : {}),
    };
  }
  if (data.type === 'feedback' && (data.query === 'helpful' || data.query === 'not_helpful')) {
    return { name: 'feedback_submitted', feedback: data.query, target: 'page', ...(path ? { path } : {}) };
  }
  return null;
};

export const legacyAnalyticsJobToEnvelope = (
  data: LegacyTrackAnalyticsEventJobData,
  context: {
    hashSalt: string;
    jobId: string;
    privacy: AnalyticsPrivacyPolicy;
    receivedAt?: Date;
    tenantId: string;
  },
): AnalyticsEventEnvelope | null => {
  const payload = legacyPayload(data);
  if (!payload) return null;
  const occurredAt = Number.isNaN(new Date(data.createdAt).getTime()) ? undefined : new Date(data.createdAt).toISOString();
  return buildAnalyticsEvent(
    {
      eventId: deterministicAnalyticsEventId(`legacy-analytics-queue:${context.jobId}`),
      ...(occurredAt ? { occurredAt } : {}),
      consentState: 'unknown',
      ...(bounded(data.sessionId, 128) ? { sessionId: bounded(data.sessionId, 128) } : {}),
      payload,
    },
    {
      tenantId: context.tenantId,
      projectId: data.projectId,
      siteId: data.projectId,
      source: 'worker',
      ...(context.receivedAt ? { receivedAt: context.receivedAt } : {}),
      ...(bounded(data.country, 2) ? { country: bounded(data.country, 2) } : {}),
      ...(bounded(data.device, 32) ? { device: bounded(data.device, 32) } : {}),
      privacy: context.privacy,
      hashSalt: context.hashSalt,
    },
  );
};
