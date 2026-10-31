import { describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/database', () => ({ prisma: {}, Prisma: {}, assignDefaultUsagePlan: vi.fn() }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), QueueNames: {} }));
vi.mock('@nibleaf/email', () => ({
  createEmailTranslator: vi.fn(),
  renderMemberJoinedEmail: vi.fn(),
  renderNewSignInEmail: vi.fn(),
  renderVerificationCodeEmail: vi.fn(),
  resolveEmailLanguage: vi.fn(),
}));
vi.mock('./keys.server', () => ({
  keys: () => ({
    BETTER_AUTH_SECRET: 'synthetic-organization-deletion-test-secret',
    BETTER_AUTH_URL: 'http://localhost:4310',
    TRUSTED_ORIGINS: ['http://localhost:4310'],
  }),
}));

import { auth } from './server';

describe('configured organization deletion endpoint', () => {
  it.each(['anonymous', 'owner'])('refuses %s before session or adapter access', async (role) => {
    const plugin = auth.options.plugins.find((plugin) => plugin.id === 'organization');
    if (!plugin || !('endpoints' in plugin)) throw new Error('Organization plugin is required');
    const getSession = vi.fn().mockResolvedValue(role === 'owner' ? { user: { id: 'owner' }, session: { activeOrganizationId: 'org-a' } } : null);
    const adapter = {
      findOne: vi.fn().mockResolvedValue({ id: 'member-a', role: 'owner', userId: 'owner', organizationId: 'org-a', user: { id: 'owner' } }),
      delete: vi.fn(),
    };
    await expect(
      plugin.endpoints.deleteOrganization({
        body: { organizationId: 'org-a' },
        headers: new Headers(),
        context: { orgOptions: plugin.options, getSession, adapter },
      }),
    ).rejects.toMatchObject({ status: 'NOT_FOUND', body: { code: 'ORGANIZATION_DELETION_DISABLED' } });
    expect(getSession).not.toHaveBeenCalled();
    expect(adapter.findOne).not.toHaveBeenCalled();
    expect(adapter.delete).not.toHaveBeenCalled();
  });
});
