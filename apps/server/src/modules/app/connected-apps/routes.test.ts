import { AppError } from '@/errors';
import { prisma } from '@nibleaf/database';
import { MemberRole } from '@nibleaf/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import connectedAppsRoutes from './routes';

vi.mock('@/actions/projects', () => ({
  assertProjectAccess: async () => {
    const member = await prisma.member.findUnique({} as never);
    if (!member || member.role === 'unknown') throw new AppError({ code: 'database:not_found' });
    return { organizationId: 'org-1', role: member.role };
  },
}));

vi.mock('@nibleaf/database', () => ({
  prisma: { user: { findUnique: vi.fn() }, project: { findUnique: vi.fn() }, member: { findUnique: vi.fn() } },
}));

const context = () => {
  const values = new Map<string, unknown>([['user', { id: 'user-1' }]]);
  return {
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => values.set(key, value),
    req: { param: () => 'project-1' },
  } as never;
};
const guarded = [
  ['list', connectedAppsRoutes.list],
  ['revoke', connectedAppsRoutes.revoke],
] as const;

describe('connected-app route permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ suspendedAt: null } as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: 'project-1', organizationId: 'org-1' } as never);
  });

  it.each(guarded)('lets project members reach %s (the action narrows members to their own apps)', async (_name, route) => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue({ role: MemberRole.MEMBER } as never);
    const next = vi.fn(async () => undefined);
    await route[1](context(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it.each(guarded)('rejects people outside the project from %s', async (_name, route) => {
    vi.mocked(prisma.member.findUnique).mockResolvedValue(null as never);
    const next = vi.fn();
    await expect(route[1](context(), next)).rejects.toMatchObject({ code: 'database:not_found' });
    expect(next).not.toHaveBeenCalled();
  });

  it.each(guarded)('rejects suspended accounts from %s', async (_name, route) => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ suspendedAt: new Date() } as never);
    const next = vi.fn();
    await expect(route[1](context(), next)).rejects.toMatchObject({ code: 'auth:invalid_session' });
    expect(next).not.toHaveBeenCalled();
  });
});
