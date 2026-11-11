import { StatusBadge, type StatusBadgeTone } from '@nibleaf/design-system/components/ui/status-badge';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useDeployments } from '@/hooks/api';
import { newestLiveDeployment } from '@/hooks/api/deployment-cache';
import type { LiveVersion } from '@/hooks/api/publish-history';
import type { Deployment, DeploymentStatus } from '@/hooks/api/types';

/** How a version reads in the history: the live one, an older published one, or an attempt. */
export type PublishState = 'live' | 'superseded' | 'failed' | 'building' | 'queued';

export const publishState = (status: DeploymentStatus, isLive: boolean): PublishState => {
  // The live marker can come from the polled publish list, which sees a version
  // go live before the history is read again: that row is live, not "Building".
  if (isLive) return 'live';
  if (status === 'READY') return 'superseded';
  if (status === 'FAILED') return 'failed';
  return status === 'BUILDING' ? 'building' : 'queued';
};

/** Only an older published version can be restored: never the live one, nor an attempt that didn't go live. */
export const canRestoreState = (state: PublishState): boolean => state === 'superseded';

const LABEL: Record<PublishState, MessageKey> = {
  live: 'deployment.status.ready',
  superseded: 'publishes.superseded',
  failed: 'deployment.status.failed',
  building: 'deployment.status.building',
  queued: 'deployment.status.pending',
};

const TONE: Record<PublishState, StatusBadgeTone> = {
  live: 'success',
  superseded: 'neutral',
  failed: 'danger',
  building: 'pending',
  queued: 'pending',
};

export function PublishStatusBadge({ state }: { state: PublishState }) {
  const t = useT();
  return (
    <StatusBadge data-state={state} tone={TONE[state]}>
      {t(LABEL[state])}
    </StatusBadge>
  );
}

/**
 * The id of the version readers see now. The server's answer comes with each
 * history read; the publish dialog's polled list sees a publish that just went
 * live first. The newest READY of the two wins, as in the publish dialog (#406).
 */
export function useLiveVersionId(projectId: string, serverLive: LiveVersion | null | undefined): string | undefined {
  const deployments = useDeployments(projectId);
  return newestLiveDeployment<Pick<Deployment, 'id' | 'status' | 'version'>>(
    deployments.data,
    serverLive ? [{ ...serverLive, status: 'READY' }] : undefined,
  )?.id;
}
