import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  organization: vi.fn(),
  organizationUpdate: vi.fn(),
  secretFind: vi.fn(),
  secretUpsert: vi.fn(),
  stripCopy: vi.fn(),
  user: vi.fn(),
}));
vi.mock('@nibleaf/database', () => {
  const prisma = {
    user: { findUnique: mocks.user },
    organization: { findUnique: mocks.organization, update: mocks.organizationUpdate, updateMany: mocks.stripCopy },
    organizationGitWebhookSecret: { findUnique: mocks.secretFind, upsert: mocks.secretUpsert },
    member: { findUnique: mocks.member, count: vi.fn(async () => 2) },
    project: { count: vi.fn(async () => 1) },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  };
  return { prisma };
});
const warn = vi.hoisted(() => vi.fn());
vi.mock('@nibleaf/logger', () => ({ logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/actions/analytics', () => ({ getWorkspaceAnalytics: vi.fn() }));
vi.mock('@/actions/projects', () => ({ assertProjectAccess: vi.fn() }));

import handlers from './handlers';

const app = new Hono<HonoEnv>();
app.use(contextStorage());
app.use(async (ctx, next) => {
  ctx.set('user', { id: 'user' } as never);
  ctx.set('organizationId', 'active-org');
  await next();
});
app.onError((error, ctx) => (error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: error.message }, 500)));
app.route('/workspace', handlers);

describe('legacy workspace settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ suspendedAt: null });
    mocks.member.mockResolvedValue({ role: 'member' });
    mocks.secretFind.mockResolvedValue(null);
    mocks.secretUpsert.mockImplementation(async ({ create }: { create: { secret: string } }) => ({ secret: create.secret }));
    mocks.organizationUpdate.mockResolvedValue({});
    mocks.stripCopy.mockResolvedValue({ count: 1 });
    mocks.organization.mockResolvedValue({
      name: 'Site',
      slug: 'site',
      metadata: JSON.stringify({
        plan: 'free',
        notifications: {},
        integrations: {},
        internalMetadata: 'private',
        git: { repo: 'acme/docs', webhookSecret: 'secret' },
      }),
    });
  });

  it('requires fresh membership in the active organization', async () => {
    mocks.member.mockResolvedValue(null);
    const response = await app.request('/workspace');
    expect(response.status).toBe(403);
    expect(mocks.member).toHaveBeenCalledWith({ where: { organizationId_userId: { organizationId: 'active-org', userId: 'user' } } });
    expect(mocks.organization).not.toHaveBeenCalled();
  });

  it('returns only scoped settings and removes the webhook secret for members', async () => {
    const response = await app.request('/workspace');
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

  it.each(['admin', 'owner'])('retains admin material for %s', async (role) => {
    mocks.member.mockResolvedValue({ role });
    const response = await app.request('/workspace');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ data: { git: { webhookSecret: 'secret' } } });
    expect(body).not.toHaveProperty('data.internalMetadata');
  });

  it('reads the secret for admins from server-only storage, not metadata', async () => {
    mocks.member.mockResolvedValue({ role: 'admin' });
    mocks.secretFind.mockResolvedValue({ secret: 'stored-secret' });
    mocks.secretUpsert.mockResolvedValue({ secret: 'stored-secret' });
    const body = await (await app.request('/workspace')).json();
    expect(body).toMatchObject({ data: { git: { repo: 'acme/docs', webhookSecret: 'stored-secret' } } });
    expect(mocks.secretFind).toHaveBeenCalledWith({ where: { organizationId: 'active-org' }, select: { secret: true } });
  });

  /** The cleanup removes only `git.webhookSecret`, and writes only over the text it read. */
  const expectAtomicStrip = () => {
    expect(mocks.stripCopy).toHaveBeenCalled();
    const [{ where, data }] = mocks.stripCopy.mock.calls[0] as [{ where: { id: string; metadata: string }; data: { metadata: string } }];
    const original = JSON.parse(where.metadata);
    expect(where.id).toBe('active-org');
    expect(original.git.webhookSecret).toBe('secret');
    const { webhookSecret: _removed, ...git } = original.git;
    expect(JSON.parse(data.metadata)).toEqual({ ...original, git });
  };

  it('moves a legacy metadata secret into server-only storage on first read, with a compare-and-set cleanup', async () => {
    mocks.member.mockResolvedValue({ role: 'owner' });
    await app.request('/workspace');
    expect(mocks.secretUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'active-org' }, create: { organizationId: 'active-org', secret: 'secret' }, update: {} }),
    );
    expectAtomicStrip();
    expect(mocks.organizationUpdate).not.toHaveBeenCalled();
  });

  it('moves a metadata copy on a member read and never returns a secret to the member', async () => {
    const body = await (await app.request('/workspace')).json();
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(mocks.secretUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: { organizationId: 'active-org', secret: 'secret' } }));
    expectAtomicStrip();
  });

  it('answers a member read when the cleanup fails after the secret is stored', async () => {
    mocks.secretFind.mockResolvedValue({ secret: 'stored-secret' });
    mocks.stripCopy.mockRejectedValue(new Error('database unavailable'));
    const response = await app.request('/workspace');
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });

  it('answers a member read when moving the copy fails, without the secret in the response or the log', async () => {
    // A database error whose message echoes the arguments, as Prisma's can.
    mocks.secretUpsert.mockRejectedValue(Object.assign(new Error('upsert failed: { secret: "secret" }'), { code: 'P2010' }));
    const response = await app.request('/workspace');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ data: { git: { repo: 'acme/docs' } } });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(warn).toHaveBeenCalledWith({ organizationId: 'active-org', code: 'P2010' }, expect.any(String));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('"secret');
  });

  it('answers an admin read when moving the copy fails, from a side-effect-free read', async () => {
    mocks.member.mockResolvedValue({ role: 'admin' });
    mocks.secretUpsert.mockRejectedValue(new Error('database unavailable'));
    const response = await app.request('/workspace');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { git: { repo: 'acme/docs', webhookSecret: 'secret' } } });
  });

  it('strips the metadata copy even when a stored secret already exists, and keeps the stored one', async () => {
    mocks.member.mockResolvedValue({ role: 'admin' });
    mocks.secretFind.mockResolvedValue({ secret: 'stored-secret' });
    mocks.secretUpsert.mockResolvedValue({ secret: 'stored-secret' });
    const body = await (await app.request('/workspace')).json();
    expect(body).toMatchObject({ data: { git: { webhookSecret: 'stored-secret' } } });
    expectAtomicStrip();
  });

  it('does not touch metadata that holds no copy', async () => {
    mocks.member.mockResolvedValue({ role: 'admin' });
    mocks.organization.mockResolvedValue({ name: 'Site', slug: 'site', metadata: JSON.stringify({ git: { repo: 'acme/docs' } }) });
    mocks.secretFind.mockResolvedValue({ secret: 'stored-secret' });
    await app.request('/workspace');
    expect(mocks.stripCopy).not.toHaveBeenCalled();
    expect(mocks.secretUpsert).not.toHaveBeenCalled();
  });

  it('answers a settings update with the scoped settings and no metadata copy of the secret', async () => {
    mocks.member.mockResolvedValue({ role: 'admin' });
    mocks.secretFind.mockResolvedValueOnce(null).mockResolvedValue({ secret: 'secret' });
    const response = await app.request('/workspace', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notifications: { member_joined: false } }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty('data.internalMetadata');
    const written = JSON.parse(mocks.organizationUpdate.mock.calls.at(-1)?.[0].data.metadata as string);
    expect(written.git).toEqual({ repo: 'acme/docs' });
    expect(mocks.secretUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: { organizationId: 'active-org', secret: 'secret' } }));
  });
});
