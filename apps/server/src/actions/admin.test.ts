import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    deployment: { findMany: vi.fn() },
    domain: { findMany: vi.fn() },
    exportJob: { findMany: vi.fn() },
    gitSyncOperation: { findMany: vi.fn() },
  },
}));

vi.mock('@nibleaf/database', () => ({ prisma: mocks.prisma }));
vi.mock('@nibleaf/shared', () => ({ slugify: (value: string) => value }));
vi.mock('@/env', () => ({ env: { APP_URL: 'https://nibleaf.test' } }));
vi.mock('./members', () => ({ inviteMember: vi.fn() }));
vi.mock('./usage', () => ({ getProjectUsage: vi.fn() }));
vi.mock('./workspace', () => ({ parseWorkspaceMetadata: () => ({ plan: 'free' }) }));

import { getAdminOperations } from './admin';

describe('admin operations privacy boundary', () => {
  beforeEach(() => {
    mocks.prisma.deployment.findMany.mockResolvedValue([
      {
        id: 'dep-1',
        version: 2,
        status: 'FAILED',
        pagesCount: 7,
        error: 'token=secret',
        createdAt: new Date('2026-08-21T00:00:00Z'),
        completedAt: null,
        project: { id: 'project-1', name: 'Docs' },
      },
    ]);
    mocks.prisma.domain.findMany.mockResolvedValue([
      {
        id: 'domain-1',
        domain: 'docs.example.com',
        provider: 'CLOUDFLARE',
        dnsStatus: 'ERROR',
        sslStatus: 'PENDING',
        isPrimary: true,
        lastError: 'provider private payload',
        lastCheckedAt: null,
        createdAt: new Date('2026-08-21T00:00:00Z'),
        project: { id: 'project-1', name: 'Docs' },
      },
    ]);
    mocks.prisma.exportJob.findMany.mockResolvedValue([]);
    mocks.prisma.gitSyncOperation.findMany.mockResolvedValue([]);
  });

  it('reports actionable status without returning raw error strings', async () => {
    const result = await getAdminOperations();
    expect(result.deployments[0]).toMatchObject({ status: 'FAILED', hasError: true });
    expect(result.domains[0]).toMatchObject({ dnsStatus: 'ERROR', hasError: true });
    expect(JSON.stringify(result)).not.toContain('token=secret');
    expect(JSON.stringify(result)).not.toContain('provider private payload');
  });

  it('selects only the domain fields needed for operations', async () => {
    await getAdminOperations();
    expect(mocks.prisma.domain.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.not.objectContaining({ providerData: expect.anything(), verificationToken: expect.anything() }) }),
    );
  });
});
