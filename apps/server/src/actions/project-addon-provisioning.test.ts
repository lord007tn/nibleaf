import { addonDefinitions } from '@nibleaf/shared/addons';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    organization: { create: vi.fn() },
    member: { create: vi.fn() },
    project: { create: vi.fn() },
    projectAddon: { createMany: vi.fn() },
    projectAddonAuditEvent: { createMany: vi.fn() },
    language: { create: vi.fn() },
    branch: { create: vi.fn() },
  };
  return {
    tx,
    assignDefaultUsagePlan: vi.fn(),
    inviteMember: vi.fn(),
    prisma: {
      project: { findFirst: vi.fn(), findUnique: vi.fn() },
      organization: { delete: vi.fn() },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock('@nibleaf/auth/tenant-erasure', () => ({
  eraseProjectOrganization: vi.fn(),
  TenantErasureProjectNotFoundError: class extends Error {},
  TenantUsageDeletionPendingError: class extends Error {},
}));
vi.mock('@nibleaf/database', () => ({
  assignDefaultUsagePlan: mocks.assignDefaultUsagePlan,
  prisma: mocks.prisma,
}));
vi.mock('@/env', () => ({ env: { APP_URL: 'https://nibleaf.test' } }));
vi.mock('./members', () => ({ inviteMember: mocks.inviteMember }));
vi.mock('./usage', () => ({ getProjectUsage: vi.fn() }));
vi.mock('./workspace', () => ({ parseWorkspaceMetadata: () => ({ plan: 'free' }) }));

import { inviteOrganizationOwner } from './admin';
import { createProject } from './projects';

const expectDefaultAddonAuditParity = (actorUserId: string) => {
  const addons = mocks.tx.projectAddon.createMany.mock.calls[0]?.[0].data;
  const events = mocks.tx.projectAddonAuditEvent.createMany.mock.calls[0]?.[0].data;
  expect(addons).toHaveLength(addonDefinitions.length);
  expect(events).toHaveLength(addons.length);
  for (const addon of addons) {
    expect(events).toContainEqual({
      projectId: addon.projectId,
      addonKey: addon.key,
      actorUserId,
      actorApiKeyId: null,
      action: 'configured',
      previousEnabled: null,
      nextEnabled: addon.enabled,
      nextConfig: addon.config,
      revision: addon.revision,
    });
  }
};

describe('project add-on provisioning audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.project.findFirst.mockResolvedValue(null);
    mocks.prisma.project.findUnique.mockResolvedValue(null);
    mocks.tx.organization.create.mockResolvedValue({ id: 'org-a' });
    mocks.tx.project.create.mockResolvedValue({ id: 'project-a', slug: 'docs' });
    mocks.tx.language.create.mockResolvedValue({ id: 'language-a' });
    mocks.tx.branch.create.mockResolvedValue({ id: 'branch-a' });
    mocks.inviteMember.mockResolvedValue({ id: 'invitation-a' });
  });

  it('creates creator-attributed configured events without losing default plan assignment', async () => {
    await createProject('creator-user', { name: 'Docs' });

    expect(mocks.assignDefaultUsagePlan).toHaveBeenCalledWith(mocks.tx, 'org-a');
    expectDefaultAddonAuditParity('creator-user');
  });

  it('creates admin-attributed configured events without losing default plan assignment', async () => {
    await inviteOrganizationOwner('admin-user', {
      organizationName: 'Docs Org',
      siteName: 'Docs',
      ownerEmail: 'owner@example.com',
      delivery: 'link',
    });

    expect(mocks.assignDefaultUsagePlan).toHaveBeenCalledWith(mocks.tx, 'org-a');
    expectDefaultAddonAuditParity('admin-user');
  });
});
