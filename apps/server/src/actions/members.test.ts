import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transactionLock } from './transaction-lock.test-helper';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
  revokeJoinLinks: vi.fn(async () => 0),
}));
vi.mock('@nibleaf/database', () => ({ prisma: { member: mocks, $transaction: mocks.transaction } }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), QueueNames: {} }));
// Join-link revocation has its own PostgreSQL tests (join-links.postgres.test.ts).
vi.mock('@nibleaf/auth/join-links', () => ({ revokeJoinLinksBeyondRole: mocks.revokeJoinLinks }));
vi.mock('@nibleaf/email', () => ({ renderMemberInvitationEmail: vi.fn() }));
vi.mock('@/env', () => ({ env: {} }));

import { removeMember, transferOwnership, updateMemberRole } from './members';

describe('workspace owner serialization', () => {
  let members: Array<{ id: string; userId: string; organizationId: string; role: string; orgRole: string; projectGrants: { role: string }[] }>;
  beforeEach(() => {
    vi.resetAllMocks();
    members = ['a', 'b', 'c'].map((id) => ({
      id,
      userId: id,
      organizationId: 'org',
      role: id === 'a' ? 'owner' : 'admin',
      orgRole: id === 'a' ? 'owner' : 'admin',
      projectGrants: [],
    }));
    mocks.findMany.mockImplementation(async () => structuredClone(members));
    mocks.findFirst.mockImplementation(async ({ where }) =>
      structuredClone(members.find((member) => (where.id ? member.id === where.id : member.userId === where.userId))),
    );
    mocks.count.mockImplementation(async () => members.filter((member) => member.role === 'owner').length);
    mocks.updateMany.mockImplementation(async ({ where, data }) => {
      for (const member of members) if (where.id ? where.id.in.includes(member.id) : member.orgRole === where.orgRole) Object.assign(member, data);
      return { count: 1 };
    });
    mocks.update.mockImplementation(async ({ where, data }) => {
      const member = members.find((entry) => entry.id === where.id);
      Object.assign(member ?? {}, data);
      return member;
    });
    mocks.delete.mockImplementation(async ({ where }) => {
      members = members.filter((member) => member.id !== where.id);
    });
    const transaction = transactionLock();
    mocks.transaction.mockImplementation((work) =>
      transaction(work, {
        member: mocks,
        organization: { findUniqueOrThrow: async () => ({ needsRepair: false, deletionStartedAt: null }) },
        project: { findMany: async () => [{ id: 'project' }] },
      }),
    );
  });

  it('allows only one of two overlapping transfers by the original owner', async () => {
    const results = await Promise.allSettled([transferOwnership('org', 'a', 'b'), transferOwnership('org', 'a', 'c')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(members.filter((member) => member.role === 'owner')).toHaveLength(1);
  });

  it.each(['demote', 'remove'])('rejects a request after the actor loses their administrative role: %s', async (operation) => {
    const actor = members.find((member) => member.id === 'a');
    if (!actor) throw new Error('Missing actor fixture');
    actor.role = 'viewer';
    actor.orgRole = 'member';
    const target = members.find((member) => member.id === 'b');
    if (!target) throw new Error('Missing target fixture');
    target.role = 'viewer';
    target.orgRole = 'member';
    const request = operation === 'demote' ? updateMemberRole('org', 'b', 'a', { role: 'member' }) : removeMember('org', 'b', 'a');
    await expect(request).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
