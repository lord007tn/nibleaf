import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), others: vi.fn(), projects: vi.fn(), remove: vi.fn() }));
vi.mock('@nibleaf/database', () => {
  const tx = { $queryRaw: mocks.query, member: { count: mocks.others }, project: { count: mocks.projects }, organization: { delete: mocks.remove } };
  return {
    Prisma: { sql: (parts: TemplateStringsArray) => parts.join('?') },
    prisma: { $transaction: (run: (client: unknown) => Promise<unknown>) => run(tx) },
  };
});

import { reassignOrDeleteOrgs } from './account-deletion';

describe('account deletion ownership policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ organizationId: 'owned' }])
      .mockResolvedValue([]);
    mocks.others.mockResolvedValue(0);
    mocks.projects.mockResolvedValue(0);
  });
  it('refuses even a sole owner with a website', async () => {
    mocks.projects.mockResolvedValue(1);
    await expect(reassignOrDeleteOrgs('owner')).rejects.toThrow('Transfer ownership or delete your organization first');
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('refuses an owner with other members and never promotes somebody', async () => {
    mocks.others.mockResolvedValue(1);
    await expect(reassignOrDeleteOrgs('owner')).rejects.toThrow('Transfer ownership');
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('removes an empty sole-member org', async () => {
    await reassignOrDeleteOrgs('owner');
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 'owned' } });
  });
});
