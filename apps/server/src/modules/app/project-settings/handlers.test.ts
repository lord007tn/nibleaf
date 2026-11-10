import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  organization: vi.fn(),
  secretFind: vi.fn(),
  secretUpsert: vi.fn(),
  orgUpdate: vi.fn(),
  git: vi.fn(),
  legacy: vi.fn(),
  projects: vi.fn(),
}));
vi.mock('@nibleaf/database', () => {
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ id: 'user', banned: false, suspendedAt: null })) },
    organization: { findUniqueOrThrow: mocks.organization, update: mocks.orgUpdate },
    projectGitSettings: { findUnique: mocks.git, upsert: vi.fn() },
    projectLegacySettings: { findUnique: mocks.legacy, upsert: vi.fn() },
    projectGitWebhookSecret: { findUnique: mocks.secretFind, upsert: mocks.secretUpsert },
    organizationGitWebhookSecret: { upsert: vi.fn() },
    member: { count: vi.fn(async () => 2) },
    project: { count: vi.fn(async () => 1), findMany: mocks.projects },
    $queryRaw: vi.fn(async () => [{ id: 'project-1', organizationId: 'site-org' }]),
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  };
  return { prisma };
});
vi.mock('@/actions/projects', () => ({ assertProjectAccess: mocks.access }));
vi.mock('@/actions/analytics', () => ({ getWorkspaceAnalytics: vi.fn() }));
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
const url = '/projects/project-1/settings';

describe('website settings partition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ organizationId: 'site-org', role: 'member' });
    mocks.projects.mockResolvedValue([{ id: 'project-1' }]);
    mocks.organization.mockResolvedValue({
      name: 'Site',
      slug: 'site',
      metadata: JSON.stringify({
        plan: 'free',
        notifications: {},
        internalMetadata: 'private',
        git: { repo: 'wrong/website', webhookSecret: 'wrong-secret' },
      }),
    });
    mocks.git.mockResolvedValue({ settings: { repo: 'acme/docs' } });
    mocks.legacy.mockResolvedValue({ metadata: { integrations: {}, internalMetadata: 'private' } });
    mocks.secretFind.mockResolvedValue({ secret: 'stored-secret' });
  });
  it('requires fresh access to the identified website', async () => {
    mocks.access.mockRejectedValue(new AppError({ code: 'database:not_found' }));
    expect((await app.request(url)).status).toBe(404);
    expect(mocks.organization).not.toHaveBeenCalled();
  });
  it('reads only this website and never returns a secret to editors', async () => {
    const response = await app.request(url);
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
    expect(mocks.git).toHaveBeenCalledWith({ where: { projectId: 'project-1' }, select: { settings: true } });
    expect(mocks.secretFind).not.toHaveBeenCalled();
    expect(mocks.orgUpdate).not.toHaveBeenCalled();
  });
  it.each(['admin', 'owner'])('reads the website secret for %s without migrating metadata', async (role) => {
    mocks.access.mockResolvedValue({ organizationId: 'site-org', role });
    expect(await (await app.request(url)).json()).toMatchObject({ data: { git: { repo: 'acme/docs', webhookSecret: 'stored-secret' } } });
    expect(mocks.secretFind).toHaveBeenCalledWith({ where: { projectId: 'project-1' }, select: { secret: true } });
    expect(mocks.secretUpsert).not.toHaveBeenCalled();
    expect(mocks.orgUpdate).not.toHaveBeenCalled();
  });
  it('refuses ambiguous legacy organization settings', async () => {
    mocks.projects.mockResolvedValue([{ id: 'project-1' }, { id: 'project-2' }]);
    expect((await app.request(url)).status).toBe(404);
    expect(mocks.git).not.toHaveBeenCalled();
  });
});

it('rotates only the requested website secret and its rollout mirror', async () => {
  mocks.access.mockResolvedValue({ organizationId: 'site-org', role: 'admin' });
  const response = await app.request('/projects/project-1/settings/git/webhook-secret', { method: 'POST' });
  expect(response.status).toBe(200);
  const { data } = (await response.json()) as { data: { webhookSecret: string } };
  expect(data.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
  expect(mocks.secretUpsert).toHaveBeenCalledWith({
    where: { projectId: 'project-1' },
    create: { projectId: 'project-1', secret: data.webhookSecret },
    update: { secret: data.webhookSecret },
  });
});
