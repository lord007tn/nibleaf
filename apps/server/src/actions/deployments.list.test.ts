import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ deploymentFindMany: vi.fn() }));

vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), QueueNames: { PUBLISH: 'publish' } }));
vi.mock('@nibleaf/database', () => ({
  // The canonical free plan as seeded in production: no entitlement rows.
  deliveryPlanSelect: {},
  loadDefaultDeliveryPlan: async () => ({ key: 'free', active: true, entitlements: [] }),
  Prisma: { PrismaClientKnownRequestError: class extends Error {}, DbNull: 'DbNull' },
  prisma: { deployment: { findMany: mocks.deploymentFindMany } },
}));

import { listDeployments } from './deployments';

describe('listDeployments', () => {
  beforeEach(() => {
    mocks.deploymentFindMany.mockReset().mockResolvedValue([]);
  });

  it('lists the newest 50 attempts of every status by default, without the snapshot', async () => {
    await listDeployments('project-1');
    const query = mocks.deploymentFindMany.mock.calls[0]?.[0];
    expect(query).toMatchObject({ where: { projectId: 'project-1' }, orderBy: { version: 'desc' }, take: 50 });
    expect(query.where).not.toHaveProperty('status');
    expect(query.select).not.toHaveProperty('snapshot');
  });

  it('lists only publishes that went live when asked, however many attempts failed after them', async () => {
    await listDeployments('project-1', { status: 'READY' });
    const query = mocks.deploymentFindMany.mock.calls[0]?.[0];
    expect(query).toMatchObject({ where: { projectId: 'project-1', status: 'READY' }, orderBy: { version: 'desc' }, take: 50 });
    expect(query.select).not.toHaveProperty('snapshot');
  });
});
