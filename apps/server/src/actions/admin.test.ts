import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    deployment: { findMany: vi.fn() },
    domain: { findMany: vi.fn() },
    exportJob: { findMany: vi.fn() },
    gitSyncOperation: { findMany: vi.fn() },
    member: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    verification: { create: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock('@nibleaf/database', () => ({ prisma: mocks.prisma }));
vi.mock('@nibleaf/shared', () => ({ slugify: (value: string) => value }));
vi.mock('@/env', () => ({ env: { APP_URL: 'https://nibleaf.test' } }));
vi.mock('./members', () => ({ inviteMember: vi.fn() }));
vi.mock('./usage', () => ({ getProjectUsage: vi.fn() }));
vi.mock('./workspace', () => ({ parseWorkspaceMetadata: () => ({ plan: 'free' }) }));

import { createAdminImpersonationGrant, getAdminOperations } from './admin';

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
    const select = mocks.prisma.domain.findMany.mock.calls[0]?.[0].select;
    expect(select).not.toHaveProperty('providerData');
    expect(select).not.toHaveProperty('verificationToken');
  });
});

describe('admin support-access grants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === 'admin-1') return Promise.resolve({ role: 'admin' });
      return Promise.resolve({ role: 'user', suspendedAt: null });
    });
    mocks.prisma.member.findFirst.mockResolvedValue({
      organizationId: 'org-1',
      organization: { name: 'Acme workspace', projects: [{ id: 'project-1', name: 'Acme docs' }] },
    });
    mocks.prisma.verification.deleteMany.mockResolvedValue({ count: 0 });
    mocks.prisma.verification.create.mockResolvedValue({ id: 'grant-1' });
  });

  it('stores only a hash of the one-time token and binds it to actor, customer, and workspace', async () => {
    const grant = await createAdminImpersonationGrant('admin-1', 'customer-1', 'org-1');

    expect(grant).toMatchObject({ organizationId: 'org-1', projectId: 'project-1' });
    expect(grant.token.length).toBeGreaterThanOrEqual(32);
    const data = mocks.prisma.verification.create.mock.calls[0]?.[0].data;
    expect(data.identifier).toMatch(/^support-impersonation:[a-f0-9]{64}$/);
    expect(data.identifier).not.toContain(grant.token);
    expect(data.value).not.toContain(grant.token);
    expect(JSON.parse(data.value)).toEqual({ actorUserId: 'admin-1', targetUserId: 'customer-1', organizationId: 'org-1' });
    expect(new Date(data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(120_000);
  });

  it('refuses to create a grant for another platform administrator', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ role: 'admin', suspendedAt: null });
    await expect(createAdminImpersonationGrant('admin-1', 'admin-2', 'org-1')).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    expect(mocks.prisma.verification.create).not.toHaveBeenCalled();
  });
});
