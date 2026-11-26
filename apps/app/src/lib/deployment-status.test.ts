import { describe, expect, it } from 'vitest';
import type { DeploymentStatus } from '@/hooks/api/types';
import { deploymentStatusLabel, deploymentStatusVariant } from './deployment-status';

const STATUSES: DeploymentStatus[] = ['PENDING', 'BUILDING', 'READY', 'FAILED'];

describe('deploymentStatusLabel', () => {
  it('resolves every status through its translated deployment.status.* key', () => {
    const t = (key: string) => `[${key}]`;
    expect(STATUSES.map((status) => deploymentStatusLabel(status, t))).toEqual([
      '[deployment.status.pending]',
      '[deployment.status.building]',
      '[deployment.status.ready]',
      '[deployment.status.failed]',
    ]);
  });
});

describe('deploymentStatusVariant', () => {
  it('maps failures to destructive, the live snapshot to primary, and in-flight states to muted', () => {
    expect(deploymentStatusVariant('FAILED')).toBe('destructive');
    expect(deploymentStatusVariant('READY')).toBe('default');
    expect(deploymentStatusVariant('PENDING')).toBe('secondary');
    expect(deploymentStatusVariant('BUILDING')).toBe('secondary');
  });
});
