import type { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({ connection: vi.fn(), update: vi.fn(async (_args: { where: unknown; data: unknown }) => ({ count: 1 })) }));
vi.mock('@nibleaf/database', () => ({ Prisma: {}, prisma: { projectIntegration: { findUnique: mocks.connection, updateMany: mocks.update } } }));
vi.mock('@nibleaf/qdrant', () => ({ getQdrantClient: () => null }));
vi.mock('@/env', () => ({ env: { SEARCH_EMBEDDING_MODEL: 'openai/text-embedding-3-small' } }));
vi.mock('./projects', () => ({ assertProjectAccess: async () => ({ role: 'admin', organizationId: 'org', project: { id: 'site' } }) }));
vi.mock('./integrations/crypto', () => ({
  decryptIntegrationSecret: () => JSON.stringify({ kind: 'workspace-ai', projectId: 'site', providerId: 'openai', apiKey: 'saved-secret' }),
  encryptIntegrationSecret: () => 'ciphertext',
}));
vi.mock('./project-config', () => ({ updateProjectConfigSection: vi.fn() }));
vi.mock('./sites', () => ({ invalidatePublishedSiteConfig: vi.fn() }));

import { getWorkspaceAiModels } from './workspace-ai';

const ctx = { get: (key: string) => (key === 'user' ? { id: 'admin-user' } : undefined) } as unknown as Context<HonoEnv>;
// Synthetic ids: an older generation, the current one, a newer one, and non-chat variants.
const catalog = ['gpt-1-legacy-test', 'gpt-6-luna', 'gpt-6.1-terra', 'gpt-7-test', 'gpt-6-luna-pro', 'gpt-6-realtime', 'text-embedding-3-small'];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ data: catalog.map((id) => ({ id })) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('direct OpenAI answer model picker', () => {
  it('offers only the GPT-6 family and newer chat models', async () => {
    mocks.connection.mockResolvedValue(null);
    await expect(getWorkspaceAiModels(ctx, 'site', { providerId: 'openai', apiKey: 'new-secret' })).resolves.toEqual({
      models: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-terra' }, { id: 'gpt-7-test' }],
    });
  });

  it('keeps offering the older model a site already saved, so it stays selected', async () => {
    mocks.connection.mockResolvedValue({
      credentialEncrypted: 'ciphertext',
      config: { answerModel: 'gpt-1-legacy-test', embeddingModel: 'openai/text-embedding-3-small' },
    });
    const { models } = await getWorkspaceAiModels(ctx, 'site', { providerId: 'openai' });
    expect(models).toContainEqual({ id: 'gpt-1-legacy-test' });
    expect(models).not.toContainEqual({ id: 'gpt-6-realtime' });
  });
});

describe('checking the saved key keeps what it learned (#566 council)', () => {
  const saved = {
    id: 'key-1',
    revision: 4,
    credentialEncrypted: 'ciphertext',
    config: { answerModel: 'gpt-6-luna', embeddingModel: 'openai/text-embedding-3-small' },
  };
  const failWith = (status: number, body: unknown = {}) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(body, { status })),
    );
  const write = () => mocks.update.mock.calls.map(([call]) => call);

  it('a key that works is healthy again, against the revision that was checked', async () => {
    mocks.connection.mockResolvedValue(saved);
    await getWorkspaceAiModels(ctx, 'site', { providerId: 'openai' });
    expect(write()).toEqual([
      {
        where: { id: 'key-1', revision: 4 },
        data: expect.objectContaining({ lastVerificationStatus: 'HEALTHY', lastVerificationCode: null, lastVerifiedAt: expect.any(Date) }),
      },
    ]);
  });

  it('a key whose model the provider no longer lists is marked so', async () => {
    mocks.connection.mockResolvedValue({ ...saved, config: { ...saved.config, answerModel: 'gpt-6-withdrawn-test' } });
    await getWorkspaceAiModels(ctx, 'site', { providerId: 'openai' });
    expect(write()[0]?.data).toMatchObject({ lastVerificationStatus: 'UNHEALTHY', lastVerificationCode: 'integration:model_unavailable' });
  });

  it.each([
    { name: 'refused', status: 401, body: {}, code: 'integration:credentials_invalid' },
    { name: 'out of credit (OpenAI)', status: 429, body: { error: { code: 'insufficient_quota' } }, code: 'integration:quota_exhausted' },
    { name: 'out of credit (402)', status: 402, body: {}, code: 'integration:quota_exhausted' },
  ])('a $name key stops serving until it is checked again', async ({ status, body, code }) => {
    mocks.connection.mockResolvedValue(saved);
    failWith(status, body);
    await expect(getWorkspaceAiModels(ctx, 'site', { providerId: 'openai' })).rejects.toThrow();
    expect(write()[0]).toMatchObject({
      where: { id: 'key-1', revision: 4 },
      data: { lastVerificationStatus: 'UNHEALTHY', lastVerificationCode: code },
    });
  });

  it('a rate limit is noted only on a key that still serves', async () => {
    mocks.connection.mockResolvedValue(saved);
    failWith(429, { error: { code: 'rate_limit_exceeded' } });
    await expect(getWorkspaceAiModels(ctx, 'site', { providerId: 'openai' })).rejects.toThrow();
    expect(write()[0]).toMatchObject({
      where: { id: 'key-1', revision: 4, lastVerificationStatus: 'HEALTHY' },
      data: { lastVerificationCode: 'integration:rate_limited' },
    });
  });

  it('an unreachable provider teaches nothing about the key, and a new key being tried is never stored', async () => {
    mocks.connection.mockResolvedValue(saved);
    failWith(503);
    await expect(getWorkspaceAiModels(ctx, 'site', { providerId: 'openai' })).rejects.toThrow();
    failWith(401);
    await expect(getWorkspaceAiModels(ctx, 'site', { providerId: 'openai', apiKey: 'new-secret' })).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
