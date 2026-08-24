import {
  type AnalyticsPayload,
  buildAnalyticsEvent,
  keys as clickHouseKeys,
  clickHouseWritesEnabled,
  deterministicAnalyticsEventId,
} from '@nibleaf/clickhouse';
import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { enqueueAnalyticsEvent } from './usage-ingest';

const log = createLogger({ processor: 'export-analytics' });

export const trackExportLifecycle = async (projectId: string, exportJobId: string, payload: AnalyticsPayload): Promise<void> => {
  const config = clickHouseKeys();
  if (!clickHouseWritesEnabled(config.ANALYTICS_MODE) || !config.ANALYTICS_HASH_SALT) return;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, organizationId: true, accessMode: true, config: true },
  });
  if (!project) return;
  const visibility =
    project.accessMode === 'PUBLIC' && (project.config as { visibility?: string } | null)?.visibility !== 'private' ? 'public' : 'private';
  const event = buildAnalyticsEvent(
    { eventId: deterministicAnalyticsEventId(`${exportJobId}:${payload.name}`), consentState: 'not_required', payload },
    {
      tenantId: project.organizationId,
      projectId,
      siteId: projectId,
      source: 'worker',
      privacy: { visibility, allowCampaignDimensions: false, allowRawPublicSearchQueries: false },
      hashSalt: config.ANALYTICS_HASH_SALT,
    },
  );
  await enqueueAnalyticsEvent(event).catch((error) => {
    log.warn({ error, projectId, exportJobId }, 'export analytics enqueue deferred');
  });
};
