import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({ member: vi.fn(), user: vi.fn(), listMembers: vi.fn() }));
vi.mock('@/lib/access', () => ({
  assertUsableAccount: async () => mocks.user(),
  resolveSiteAccess: async (userId: string, projectId: string) => {
    const member = await mocks.member(userId, projectId);
    if (!member) throw (await import('@/errors')).notFound('project');
    return { organizationId: 'resource-org', role: member.role };
  },
}));
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

  it('requires current membership of the resource website', async () => {
    mocks.member.mockResolvedValue(null);
    const response = await app.request('/members?projectId=site');
    expect(response.status).toBe(404);
    expect(mocks.member).toHaveBeenCalledWith('user', 'site');
    expect(mocks.listMembers).not.toHaveBeenCalled();
  });

  it('lists members for a current member', async () => {
    mocks.member.mockResolvedValue({ role: 'member' });
    const response = await app.request('/members?projectId=site');
    expect(response.status).toBe(200);
    expect(mocks.listMembers).toHaveBeenCalledWith('resource-org');
  });
});
