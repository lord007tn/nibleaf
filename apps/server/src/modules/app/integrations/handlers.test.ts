import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  memberRole: 'member' as string | null,
  activate: vi.fn(),
  create: vi.fn(async () => ({ id: 'connection-1', credential: { configured: true } })),
  createDeleteConfirmation: vi.fn(),
  deactivate: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(async () => ({ id: 'slack' })),
  list: vi.fn(async () => []),
  update: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    project: { findUnique: vi.fn(async () => ({ id: 'project-1', organizationId: 'org-1' })) },
    member: { findUnique: vi.fn(async () => (mocks.memberRole ? { role: mocks.memberRole } : null)) },
  },
}));

vi.mock('@/actions/integrations', () => ({
  activateProjectIntegration: mocks.activate,
  createIntegrationDeleteConfirmation: mocks.createDeleteConfirmation,
  createProjectIntegration: mocks.create,
  deactivateProjectIntegration: mocks.deactivate,
  deleteProjectIntegration: mocks.delete,
  getProjectIntegration: mocks.get,
  listProjectIntegrations: mocks.list,
  updateProjectIntegration: mocks.update,
  verifyProjectIntegration: mocks.verify,
}));

import handlers from './handlers';

const appFor = (authenticated = true) => {
  const app = new Hono<HonoEnv>();
  app.use('*', contextStorage());
  app.use('*', async (ctx, next) => {
    ctx.set('user', authenticated ? { id: 'user-1', name: 'User', email: 'user@example.com' } : null);
    ctx.set('apiKey', null);
    ctx.set('organizationId', null);
    ctx.set('membership', null);
    ctx.set('locale', 'en');
    await next();
  });
  app.onError((error, ctx) =>
    error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: { message: error.message } }, 500),
  );
  app.route('/projects/:projectId/integrations', handlers);
  return app;
};

describe('integration transport boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memberRole = 'member';
  });

  it('requires authentication and returns not-found for a cross-tenant caller', async () => {
    expect((await appFor(false).request('/projects/project-1/integrations')).status).toBe(401);
    mocks.memberRole = null;
    const crossTenant = await appFor().request('/projects/project-1/integrations');
    expect(crossTenant.status).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('allows members to list but requires admins for credential creation', async () => {
    expect((await appFor().request('/projects/project-1/integrations')).status).toBe(200);
    const response = await appFor().request('/projects/project-1/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'slack',
        webhookUrl: 'https://hooks.slack.com/services/T/B/token',
        idempotencyKey: 'route-key-1',
      }),
    });
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects unsupported providers and invalid secret configuration before actions run', async () => {
    mocks.memberRole = 'admin';
    const provider = await appFor().request('/projects/project-1/integrations/unknown');
    expect(provider.status).toBe(422);
    await expect(provider.json()).resolves.toMatchObject({ error: { code: 'integration:provider_unsupported' } });

    const configuration = await appFor().request('/projects/project-1/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'slack',
        webhookUrl: 'https://attacker.example/webhook',
        idempotencyKey: 'route-key-2',
      }),
    });
    expect(configuration.status).toBe(422);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('passes a validated provider-specific credential to the dashboard action only', async () => {
    mocks.memberRole = 'admin';
    const body = {
      providerId: 'discord' as const,
      webhookUrl: 'https://discord.com/api/webhooks/1/token',
      label: 'Deployments',
      idempotencyKey: 'route-key-3',
    };
    const response = await appFor().request('/projects/project-1/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), 'project-1', body);
  });
});
