import { prisma } from '@nibleaf/database';
import { MemberRole } from '@nibleaf/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireProjectRole } from './index';

vi.mock('@nibleaf/database', () => ({
  prisma: { project: { findUnique: vi.fn() }, member: { findUnique: vi.fn() } },
}));

const context = () => {
  const values = new Map<string, unknown>([['user', { id: 'user-1' }]]);
  return {
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => values.set(key, value),
    req: { param: () => 'project-1' },
  } as never;
};

describe('Git route permissions', () => {
  beforeEach(() => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: 'project-1', organizationId: 'org-1' } as never);
  });

  it('allows members to queue authoring operations', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ role: MemberRole.MEMBER } as never);
    const next = vi.fn(async () => undefined);
    await requireProjectRole(MemberRole.MEMBER)(context(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects members from credential administration', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ role: MemberRole.MEMBER } as never);
    await expect(requireProjectRole(MemberRole.ADMIN)(context(), vi.fn())).rejects.toMatchObject({ code: 'auth:insufficient_role' });
  });

  it('allows admins to rotate credentials and webhook secrets', async () => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ role: MemberRole.ADMIN } as never);
    const next = vi.fn(async () => undefined);
    await requireProjectRole(MemberRole.ADMIN)(context(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
