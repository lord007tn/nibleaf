import type { MessageKey } from '@nibleaf/i18n';
import type { DeploymentStatus } from '@/hooks/api/types';

type Translate = (key: MessageKey) => string;

const STATUS_KEY: Record<DeploymentStatus, MessageKey> = {
  PENDING: 'deployment.status.pending',
  BUILDING: 'deployment.status.building',
  READY: 'deployment.status.ready',
  FAILED: 'deployment.status.failed',
};

/** The localized, human label for a deployment status enum ("READY" → "Live"). */
export const deploymentStatusLabel = (status: DeploymentStatus, t: Translate): string => t(STATUS_KEY[status]);

/** The design-system Badge variant for a status: failures read as destructive,
 *  the live snapshot as primary, and in-flight states stay muted. */
export const deploymentStatusVariant = (status: DeploymentStatus): 'default' | 'destructive' | 'secondary' => {
  if (status === 'FAILED') {
    return 'destructive';
  }
  return status === 'READY' ? 'default' : 'secondary';
};
