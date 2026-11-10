import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), owned: vi.fn() }));
vi.mock('@nibleaf/database', () => ({
  Prisma: { sql: (parts: TemplateStringsArray) => parts.join('?') },
  prisma: { $transaction: (run: (tx: unknown) => Promise<unknown>) => run({ $queryRaw: mocks.query, member: { findFirst: mocks.owned } }) },
}));

import { reassignOrDeleteOrgs } from './account-deletion';

describe('personal account deletion ownership policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([]);
  });
  it('refuses any owned organization, without special treatment for empty ones', async () => {
    mocks.owned.mockResolvedValue({ id: 'owned' });
    await expect(reassignOrDeleteOrgs('owner')).rejects.toThrow('Transfer ownership or delete your organization first');
    expect(mocks.owned).toHaveBeenCalledWith({ where: { userId: 'owner', orgRole: 'owner' }, select: { id: true } });
    expect(mocks.query).toHaveBeenCalledOnce();
  });
  it('allows a user who owns no organization', async () => {
    mocks.owned.mockResolvedValue(null);
    await expect(reassignOrDeleteOrgs('member')).resolves.toBeUndefined();
  });
});
