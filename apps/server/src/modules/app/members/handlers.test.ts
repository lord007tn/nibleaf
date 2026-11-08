import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({ member: vi.fn(), user: vi.fn(), listMembers: vi.fn() }));
vi.mock('@nibleaf/database', () => ({
  prisma: {
    user: { findUnique: mocks.user },
    member: { findUnique: mocks.member },
  },
}));
vi.mock('@/actions/members', () => ({
  listMembers: mocks.listMembers,
  inviteMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  cancelInvitation: vi.fn(),
}));

import handlers from './handlers';

const app = new Hono<HonoEnv>();
app.use(contextStorage());
app.use(async (ctx, next) => {
  ctx.set('user', { id: 'user' } as never);
  ctx.set('organizationId', 'active-org');
  await next();
});
app.onError((error, ctx) => (error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: error.message }, 500)));
app.route('/members', handlers);

describe('workspace member list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ suspendedAt: null });
    mocks.listMembers.mockResolvedValue({ members: [], invitations: [] });
  });

  it('requires current membership of the active workspace', async () => {
    mocks.member.mockResolvedValue(null);
    const response = await app.request('/members');
    expect(response.status).toBe(403);
    expect(mocks.member).toHaveBeenCalledWith({ where: { organizationId_userId: { organizationId: 'active-org', userId: 'user' } } });
    expect(mocks.listMembers).not.toHaveBeenCalled();
  });

  it('lists members for a current member', async () => {
    mocks.member.mockResolvedValue({ role: 'member' });
    const response = await app.request('/members');
    expect(response.status).toBe(200);
    expect(mocks.listMembers).toHaveBeenCalledWith('active-org');
  });
});
