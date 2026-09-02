import { describe, expect, it, vi } from 'vitest';
import type { DeploymentStatus } from '@/hooks/api/types';
import { deploymentStatusLabel, deploymentStatusVariant } from './deployment-status';

const STATUSES: DeploymentStatus[] = ['PENDING', 'BUILDING', 'READY', 'FAILED'];

describe('deploymentStatusLabel', () => {
  it('resolves every status through its translated deployment.status.* key', () => {
    const t = vi.fn((key: string) => `[${key}]`);
    expect(STATUSES.map((status) => deploymentStatusLabel(status, t))).toEqual([
      '[deployment.status.pending]',
      '[deployment.status.building]',
      '[deployment.status.ready]',
      '[deployment.status.failed]',
    ]);
    expect(t).toHaveBeenCalledTimes(STATUSES.length);
  });

  it('never leaks the raw enum into the label', () => {
    const t = (key: string) => key;
    for (const status of STATUSES) {
      expect(deploymentStatusLabel(status, t)).not.toBe(status);
    }
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
