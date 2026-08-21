import { prisma } from '@nibleaf/database';
import { describe, expect, it, vi } from 'vitest';
import { isAdmin } from './is-admin';

vi.mock('@nibleaf/database', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('@/lib/hono/context', () => ({ getContextUserOrThrow: () => ({ id: 'user-1' }) }));

describe('platform admin guard', () => {
  it('allows a current platform admin role from the database', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'admin' } as never);
    const next = vi.fn(async () => undefined);
    await isAdmin({} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([{ role: 'user' }, null])('rejects the account record %j', async (record) => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(record as never);
    const next = vi.fn(async () => undefined);
    await expect(isAdmin({} as never, next)).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    expect(next).not.toHaveBeenCalled();
  });
});
