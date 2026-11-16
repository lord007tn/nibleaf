import { logger } from '@nibleaf/logger';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import { errorMiddleware } from '@/errors/handler';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  organization: vi.fn(),
  secretFind: vi.fn(),
  secretUpsert: vi.fn(),
  orgUpdate: vi.fn(),
  git: vi.fn(),
  gitUpsert: vi.fn(),
  legacyUpsert: vi.fn(),
  legacy: vi.fn(),
  projects: vi.fn(),
}));
vi.mock('@nibleaf/database', () => {
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ id: 'user', banned: false, suspendedAt: null })) },
    organization: { findUniqueOrThrow: mocks.organization, update: mocks.orgUpdate },
    projectGitSettings: { findUnique: mocks.git, upsert: mocks.gitUpsert },
    projectLegacySettings: { findUnique: mocks.legacy, upsert: mocks.legacyUpsert },
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
app.onError(errorMiddleware({ isDevelopment: false }));
app.route('/workspace', handlers);
const url = '/workspace?projectId=project-1';

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

describe('website settings PATCH: Git URLs', () => {
  const patch = (body: unknown) => app.request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    mocks.access.mockResolvedValue({ organizationId: 'site-org', role: 'admin' });
    mocks.projects.mockResolvedValue([{ id: 'project-1' }]);
    mocks.organization.mockResolvedValue({ name: 'Site', slug: 'site', metadata: JSON.stringify({ plan: 'free' }) });
    mocks.git.mockResolvedValue({
      settings: { provider: 'git', cloneUrl: 'https://git.example.com/old.git', lastImportedAt: '2026-11-01T08:00:00.000Z' },
    });
    mocks.legacy.mockResolvedValue({ metadata: { integrations: {} } });
    mocks.secretFind.mockResolvedValue({ secret: 'stored-secret' });
  });

  // Each one used to throw from the http(s) refinement after z.url() refused it: an unhandled 500.
  it.each([
    ['cloneUrl', { provider: 'git', cloneUrl: '' }],
    ['cloneUrl', { provider: 'git', cloneUrl: '   ', connected: true }],
    ['cloneUrl', { provider: 'git', cloneUrl: 'git.example.com/acme/docs.git', autoPublish: true }],
    ['instanceUrl', { provider: 'gitlab', repo: 'group/docs', instanceUrl: '' }],
    ['instanceUrl', { provider: 'gitlab', repo: 'group/docs', instanceUrl: ' ', connected: false }],
    ['instanceUrl', { provider: 'gitlab', repo: 'group/docs', instanceUrl: 'not a url' }],
  ])('%s %j: 422 validation:failed at that field, and nothing is written', async (field, git) => {
    const response = await patch({ git });
    expect(response.status).toBe(422);
    const { error } = (await response.json()) as { error: { code: string; details: { issues: Array<{ path: unknown[] }> } } };
    expect(error.code).toBe('validation:failed');
    expect(error.details.issues.length).toBeGreaterThan(0);
    for (const issue of error.details.issues) expect(issue.path).toEqual(['git', field]);
    expect(logger.error).not.toHaveBeenCalled();
    // The admin check ran first; the action never did.
    expect(mocks.access).toHaveBeenCalledWith('user', 'project-1');
    expect(mocks.git).not.toHaveBeenCalled();
    expect(mocks.gitUpsert).not.toHaveBeenCalled();
    expect(mocks.legacyUpsert).not.toHaveBeenCalled();
    expect(mocks.orgUpdate).not.toHaveBeenCalled();
    expect(mocks.secretUpsert).not.toHaveBeenCalled();
  });

  it('a valid clone URL is stored as sent, with the import bookkeeping kept and the secret untouched', async () => {
    const git = { provider: 'git', cloneUrl: 'https://git.example.com/acme/docs.git', connected: true };
    const response = await patch({ git });
    expect(response.status).toBe(200);
    const settings = { ...git, lastImportedAt: '2026-11-01T08:00:00.000Z' };
    expect(mocks.gitUpsert).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      create: { projectId: 'project-1', settings },
      update: { settings },
    });
    expect(mocks.secretUpsert).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a member is refused before validation', async () => {
    mocks.access.mockResolvedValue({ organizationId: 'site-org', role: 'member' });
    expect((await patch({ git: { provider: 'git', cloneUrl: '' } })).status).toBe(403);
    expect(mocks.gitUpsert).not.toHaveBeenCalled();
  });
});
