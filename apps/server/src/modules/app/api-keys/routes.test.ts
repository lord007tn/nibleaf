import { prisma } from '@nibleaf/database';
import { MemberRole } from '@nibleaf/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiKeysRoutes from './routes';

vi.mock('@nibleaf/database', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    member: { findUnique: vi.fn() },
  },
}));

const context = () => {
  const values = new Map<string, unknown>([['user', { id: 'user-1' }]]);
  return {
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => values.set(key, value),
    req: { param: () => 'project-1' },
  } as never;
};

const guardedRoutes = [
  ['list', apiKeysRoutes.list],
  ['create', apiKeysRoutes.create],
  ['rotate', apiKeysRoutes.rotate],
  ['revoke', apiKeysRoutes.revoke],
] as const;

describe('API-key lifecycle route permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ suspendedAt: null } as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: 'project-1', organizationId: 'org-1' } as never);
  });

  it.each(guardedRoutes)('rejects project members from %s', async (_name, route) => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ role: MemberRole.MEMBER } as never);
    await expect(route[1](context(), vi.fn())).rejects.toMatchObject({ code: 'auth:insufficient_role' });
  });

  it.each(guardedRoutes)('allows project admins to %s', async (_name, route) => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ role: MemberRole.ADMIN } as never);
    const next = vi.fn(async () => undefined);
    await route[1](context(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
