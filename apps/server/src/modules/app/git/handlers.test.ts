import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  role: 'member' as string,
  authorizeGitHub: vi.fn(async () => ({ login: 'octocat', name: 'The Octocat' })),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    project: { findUnique: vi.fn(async () => ({ id: 'project', organizationId: 'org' })) },
    member: { findUnique: vi.fn(async () => ({ role: mocks.role })) },
  },
}));

vi.mock('@/actions/git/workflow', () => ({
  authorizeGitHub: mocks.authorizeGitHub,
  connectGitHub: vi.fn(),
  gitWorkspaceStatus: vi.fn(),
  queueGitOperation: vi.fn(),
  resolveGitConflict: vi.fn(),
  rotateConnectionWebhookSecret: vi.fn(),
}));

import handlers from './handlers';

const appFor = (authenticated: boolean) => {
  const app = new Hono<HonoEnv>();
  app.use('*', contextStorage());
  app.use('*', async (ctx, next) => {
    ctx.set('user', authenticated ? { id: 'user', name: 'User', email: 'user@example.com' } : null);
    ctx.set('organizationId', null);
    ctx.set('membership', null);
    await next();
  });
  app.onError((error, ctx) =>
    error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: { message: error.message } }, 500),
  );
  app.route('/projects/:projectId/git', handlers);
  return app;
};

describe('Git provider authorization permissions', () => {
  beforeEach(() => {
    mocks.role = 'member';
    vi.clearAllMocks();
  });

  it('does not accept provider credentials from anonymous callers', async () => {
    const response = await appFor(false).request('/projects/project/git/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'github_pat_12345678901234567890' }),
    });
    expect(response.status).toBe(401);
    expect(mocks.authorizeGitHub).not.toHaveBeenCalled();
  });

  it('requires a project admin to verify a provider identity', async () => {
    const response = await appFor(true).request('/projects/project/git/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'github_pat_12345678901234567890' }),
    });
    expect(response.status).toBe(403);
    expect(mocks.authorizeGitHub).not.toHaveBeenCalled();
  });

  it('validates and verifies an admin credential without persisting it', async () => {
    mocks.role = 'admin';
    const response = await appFor(true).request('/projects/project/git/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'github_pat_12345678901234567890' }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { login: 'octocat', name: 'The Octocat' } });
    expect(mocks.authorizeGitHub).toHaveBeenCalledWith('github_pat_12345678901234567890');
  });
});
