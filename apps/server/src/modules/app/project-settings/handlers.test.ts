import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  organization: vi.fn(),
  organizationUpdate: vi.fn(),
  secretFind: vi.fn(),
  secretUpsert: vi.fn(),
  stripCopy: vi.fn(),
}));
vi.mock('@nibleaf/database', () => {
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    organization: { findUnique: mocks.organization, update: mocks.organizationUpdate, updateMany: mocks.stripCopy },
    organizationGitWebhookSecret: { findUnique: mocks.secretFind, upsert: mocks.secretUpsert },
    member: { count: vi.fn(async () => 2) },
    project: { count: vi.fn(async () => 1) },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  };
  return { prisma };
});
vi.mock('@/actions/projects', () => ({ assertProjectAccess: mocks.access }));
vi.mock('@/actions/git-import', () => ({ importFromGitProvider: vi.fn() }));
vi.mock('@/actions/notifications', () => ({ createNotificationsForOrgMembers: vi.fn() }));
vi.mock('@/actions/search', () => ({
  createProjectSearchReindex: vi.fn(),
  getProjectSearchConfiguration: vi.fn(),
  getProjectSearchIndexDiagnostics: vi.fn(),
  updateProjectSearchConfiguration: vi.fn(),
}));
vi.mock('@/actions/usage', () => ({ getProjectUsageSummary: vi.fn() }));
vi.mock('@/actions/workspace-ai', () => ({
  getWorkspaceAi: vi.fn(),
  getWorkspaceAiModels: vi.fn(),
  saveWorkspaceAiConnection: vi.fn(),
  selectWorkspaceAi: vi.fn(),
}));

import handlers from './handlers';

const app = new Hono<HonoEnv>();
app.use(contextStorage());
app.use(async (ctx, next) => {
  ctx.set('user', { id: 'user' } as never);
  await next();
});
app.onError((error, ctx) => (error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: error.message }, 500)));
app.route('/projects/:projectId/settings', handlers);

const metadata = {
  plan: 'free',
  notifications: {},
  integrations: {},
  internalMetadata: 'private',
  git: { repo: 'acme/docs', webhookSecret: 'legacy-secret' },
};

describe('site settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ organizationId: 'site-org', role: 'member' });
    mocks.organization.mockResolvedValue({ name: 'Site', slug: 'site', metadata: JSON.stringify(metadata) });
    mocks.organizationUpdate.mockResolvedValue({});
    mocks.secretFind.mockResolvedValue({ secret: 'stored-secret' });
    // The table already holds a secret, so an upsert keeps it.
    mocks.secretUpsert.mockResolvedValue({ secret: 'stored-secret' });
    mocks.stripCopy.mockResolvedValue({ count: 1 });
  });

  it('returns the scoped settings to members, without any webhook secret', async () => {
    const response = await app.request('/projects/project-1/settings');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        plan: 'free',
        notifications: {},
        integrations: {},
        git: { repo: 'acme/docs' },
        name: 'Site',
        slug: 'site',
        projectCount: 1,
        memberCount: 2,
      },
    });
  });

  it.each(['admin', 'owner'])('returns the server-side webhook secret to %s', async (role) => {
    mocks.access.mockResolvedValue({ organizationId: 'site-org', role });
    const body = await (await app.request('/projects/project-1/settings')).json();
    expect(body).toMatchObject({ data: { git: { repo: 'acme/docs', webhookSecret: 'stored-secret' } } });
    expect(body).not.toHaveProperty('data.internalMetadata');
  });

  it('rotates the secret in server-only storage and drops the metadata copy', async () => {
    mocks.access.mockResolvedValue({ organizationId: 'site-org', role: 'admin' });
    const response = await app.request('/projects/project-1/settings/git/webhook-secret', { method: 'POST' });
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as { data: { webhookSecret: string } };
    expect(data.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.secretUpsert).toHaveBeenCalledWith({
      where: { organizationId: 'site-org' },
      create: { organizationId: 'site-org', secret: data.webhookSecret },
      update: { secret: data.webhookSecret },
    });
    const [cleanup] = mocks.stripCopy.mock.calls.at(-1) as [{ where: { id: string; metadata: string }; data: { metadata: string } }];
    expect(cleanup.where).toEqual({ id: 'site-org', metadata: JSON.stringify(metadata) });
    expect(JSON.parse(cleanup.data.metadata).git).toEqual({ repo: 'acme/docs' });
    expect(mocks.organizationUpdate).not.toHaveBeenCalled();
  });
});
