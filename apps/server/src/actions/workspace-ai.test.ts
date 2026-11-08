import type { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({ connection: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ Prisma: {}, prisma: { projectIntegration: { findUnique: mocks.connection } } }));
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
