import type { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

/**
 * The AI answers contract (operations/ux/ai-and-integrations.md §4.6, PR 2):
 * what the server can offer a site (capabilities) and where the site stands
 * (status), derived from runtime configuration only, never carrying a key.
 */

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  config: null as unknown,
  qdrant: true,
  usage: { answersToday: 37 as number | null, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' },
  connections: [] as Record<string, unknown>[],
  deployment: null as Record<string, unknown> | null,
  run: null as Record<string, unknown> | null,
  created: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
}));
const baseEnv = {
  OPENROUTER_API_KEY: 'operator-secret-key' as string | undefined,
  SEARCH_ANSWER_ENABLED: true,
  SEARCH_ANSWER_MODEL: 'openai/gpt-6-luna',
  SEARCH_ANSWER_DAILY_PER_PROJECT: 200,
  SEARCH_EMBEDDING_MODEL: 'openai/text-embedding-3-large',
  INTEGRATION_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') as string | undefined,
  INTEGRATION_CREDENTIAL_PREVIOUS_KEYS: [] as string[],
};

vi.mock('@/env', () => ({
  get env() {
    return state.env;
  },
}));
vi.mock('@nibleaf/search/keys', () => ({
  keys: () => ({ SEARCH_ANSWER_ENABLED: state.env.SEARCH_ANSWER_ENABLED, SEARCH_EMBEDDING_MODEL: state.env.SEARCH_EMBEDDING_MODEL }),
}));
vi.mock('@nibleaf/qdrant', () => ({ getQdrantClient: () => (state.qdrant ? {} : null) }));
vi.mock('@/lib/ai-search/quota', () => ({ readAnswerQuota: vi.fn(async () => state.usage) }));
vi.mock('@nibleaf/database', () => ({
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  prisma: {
    projectIntegration: {
      findMany: async () => state.connections,
      findUnique: async ({ where }: { where: { projectId_providerId: { providerId: string } } }) =>
        state.connections.find((row) => row.providerId === where.projectId_providerId.providerId) ?? null,
    },
    deployment: { findFirst: async () => state.deployment },
    searchIndexRun: { findFirst: async () => state.run },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        projectIntegration: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            state.created.push(data);
            return { id: 'created', ...data };
          },
          updateMany: async ({ data }: { data: Record<string, unknown> }) => {
            state.updated.push(data);
            return { count: 1 };
          },
        },
        integrationAuditEvent: { create: async () => ({}) },
      }),
  },
}));
vi.mock('./projects', () => ({
  assertProjectAccess: async () => ({ role: 'admin', organizationId: 'org', project: { id: 'site', config: state.config } }),
}));
vi.mock('./project-config', () => ({ updateProjectConfigSection: vi.fn() }));
vi.mock('./sites', () => ({ invalidatePublishedSiteConfig: vi.fn() }));

import { encryptIntegrationSecret } from './integrations/crypto';
import { getWorkspaceAi, saveWorkspaceAiConnection } from './workspace-ai';

const ctx = { get: (key: string) => (key === 'user' ? { id: 'admin-user' } : undefined) } as unknown as Context<HonoEnv>;
const created = new Date('2026-11-10T09:00:00.000Z');
const storedKey = (providerId: 'openai' | 'openrouter', overrides: Record<string, unknown> = {}) => ({
  id: `key-${providerId}`,
  projectId: 'site',
  providerId,
  status: 'ACTIVE',
  lastVerificationStatus: 'HEALTHY',
  lastVerificationCode: null,
  lastVerifiedAt: created,
  config: { answerModel: 'gpt-6-luna', embeddingModel: 'openai/text-embedding-3-large' },
  credentialEncrypted: encryptIntegrationSecret(
    JSON.stringify({ kind: 'workspace-ai', projectId: 'site', providerId, apiKey: `sk-site-${providerId}-secret-4f2a` }),
  ),
  credentialHint: '4f2a',
  revision: 1,
  createdById: 'admin-user',
  createdAt: created,
  updatedAt: created,
  ...overrides,
});

beforeEach(() => {
  state.env = { ...baseEnv };
  state.config = null;
  state.qdrant = true;
  state.usage = { answersToday: 37, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' };
  state.connections = [];
  state.deployment = { id: 'deployment-12', version: 12, completedAt: new Date('2026-11-11T08:00:00.000Z') };
  state.run = { status: 'READY', errorCode: null, indexedPages: 128, indexedChunks: 900, completedAt: new Date('2026-11-11T08:05:00.000Z') };
  state.created = [];
  state.updated = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('capabilities', () => {
  it('offers everything the server can serve', async () => {
    const { capabilities } = await getWorkspaceAi(ctx, 'site');
    expect(capabilities).toEqual({
      managed: { available: true, reason: null, model: { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna' }, dailyAnswerLimit: 200 },
      ownKey: { available: true, reason: null },
      providers: [
        { id: 'openai', available: true, reason: null },
        { id: 'openrouter', available: true, reason: null },
      ],
      answers: { available: true, reason: null },
    });
  });

  it.each([
    {
      name: 'no server AI key',
      env: { OPENROUTER_API_KEY: undefined },
      expected: { managed: { available: false, reason: 'noServerKey', model: null } },
    },
    {
      name: 'answers turned off on the server',
      env: { SEARCH_ANSWER_ENABLED: false },
      expected: { managed: { available: false, reason: 'answersDisabledOnServer', model: { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna' } } },
    },
    {
      name: 'no credential encryption key',
      env: { INTEGRATION_CREDENTIAL_ENCRYPTION_KEY: undefined },
      expected: {
        ownKey: { available: false, reason: 'credentialStorageMissing' },
        providers: [
          { id: 'openai', available: false, reason: 'credentialStorageMissing' },
          { id: 'openrouter', available: false, reason: 'credentialStorageMissing' },
        ],
      },
    },
    {
      name: 'an embedding model only OpenRouter serves',
      env: { SEARCH_EMBEDDING_MODEL: 'qwen/qwen3-embedding-8b' },
      expected: {
        providers: [
          { id: 'openai', available: false, reason: 'embeddingModelRequiresOpenRouter' },
          { id: 'openrouter', available: true, reason: null },
        ],
      },
    },
  ])('follows the runtime configuration: $name', async ({ env, expected }) => {
    Object.assign(state.env, env);
    const { capabilities } = await getWorkspaceAi(ctx, 'site');
    expect(capabilities).toMatchObject(expected);
  });

  it('says when the search answers need is missing', async () => {
    state.qdrant = false;
    const { capabilities } = await getWorkspaceAi(ctx, 'site');
    expect(capabilities.answers).toEqual({ available: false, reason: 'searchNotConfigured' });
  });
});

describe('status', () => {
  it('starts on the server provider, off', async () => {
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status).toEqual({
      answersOn: false,
      source: 'managed',
      sourceReady: true,
      connections: [],
      published: { version: 12, at: '2026-11-11T08:00:00.000Z' },
      preparation: { state: 'ready', pages: 128, at: '2026-11-11T08:05:00.000Z' },
      usage: { answersToday: 37, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' },
    });
  });

  it('reports a site key by its hint, date and model name', async () => {
    state.config = { search: { aiProvider: 'openai', aiAnswers: true } };
    state.connections = [storedKey('openai')];
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status).toMatchObject({ answersOn: true, source: 'openai', sourceReady: true });
    expect(status.connections).toEqual([
      { id: 'openai', state: 'ok', keyHint: '4f2a', addedAt: '2026-11-10T09:00:00.000Z', model: { id: 'gpt-6-luna', label: 'GPT-6 Luna' } },
    ]);
  });

  it.each([
    { name: 'failed its last check', overrides: { lastVerificationStatus: 'UNHEALTHY' }, state: 'rejected' },
    { name: 'was marked broken', overrides: { status: 'ERROR' }, state: 'rejected' },
    {
      name: 'was checked for another embedding model',
      overrides: { config: { answerModel: 'm', embeddingModel: 'openai/old' } },
      state: 'needsRecheck',
    },
    { name: 'cannot be decrypted', overrides: { credentialEncrypted: 'not-an-envelope' }, state: 'unreadable' },
  ])('a selected key that $name is not ready', async ({ overrides, state: keyState }) => {
    state.config = { search: { aiProvider: 'openai', aiAnswers: true } };
    state.connections = [storedKey('openai', overrides)];
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status.connections[0]?.state).toBe(keyState);
    expect(status.sourceReady).toBe(false);
  });

  it('has no source once AI is turned off for the site', async () => {
    state.config = { search: { aiProvider: 'disabled', aiAnswers: false } };
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status).toMatchObject({ answersOn: false, source: null, sourceReady: false });
  });

  it('is not ready on the server provider when the server cannot answer', async () => {
    state.env.SEARCH_ANSWER_ENABLED = false;
    state.config = { search: { aiAnswers: true } };
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status).toMatchObject({ answersOn: true, source: 'managed', sourceReady: false });
  });

  it.each([
    { name: 'nothing published', deployment: null, run: null, published: null, preparation: { state: 'none', pages: 0, at: null } },
    { name: 'never prepared', run: null, preparation: { state: 'none', pages: 0, at: null } },
    { name: 'queued', run: { status: 'PENDING', indexedPages: 0, indexedChunks: 0, completedAt: null }, preparation: { state: 'running' } },
    {
      name: 'preparing',
      run: { status: 'RUNNING', indexedPages: 40, indexedChunks: 300, completedAt: null },
      preparation: { state: 'running', pages: 40 },
    },
    { name: 'failed', run: { status: 'FAILED', indexedPages: 0, indexedChunks: 0, completedAt: null }, preparation: { state: 'failed' } },
    { name: 'ready but empty', run: { status: 'READY', indexedPages: 0, indexedChunks: 0, completedAt: null }, preparation: { state: 'none' } },
  ])('describes preparation when $name', async (row) => {
    if ('deployment' in row) state.deployment = row.deployment ?? null;
    state.run = row.run;
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status.preparation).toMatchObject(row.preparation);
    if ('published' in row) expect(status.published).toBe(row.published);
  });

  it('passes an unreadable answer counter through as unknown', async () => {
    state.usage = { answersToday: null, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' };
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status.usage.answersToday).toBeNull();
  });
});

describe('secrets', () => {
  it('never returns a key, a key prefix, a ciphertext or the server key', async () => {
    state.config = { search: { aiProvider: 'openrouter', aiAnswers: true } };
    state.connections = [storedKey('openai'), storedKey('openrouter')];
    const body = JSON.stringify(await getWorkspaceAi(ctx, 'site'));
    for (const secret of [
      'sk-site-openai-secret',
      'sk-site-openrouter-secret',
      'sk-',
      'operator-secret-key',
      storedKey('openai').credentialEncrypted,
    ]) {
      expect(body).not.toContain(secret);
    }
  });

  it('stores only the last four characters of a newly saved key, and keeps the hint when the key is kept', async () => {
    const apiKey = 'sk-proj-new-site-key-9z8y';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: [{ id: 'gpt-6-luna' }, { id: 'text-embedding-3-large' }] })),
    );

    await saveWorkspaceAiConnection(ctx, 'site', { providerId: 'openai', apiKey, answerModel: 'gpt-6-luna', expectedRevision: 0 });
    expect(state.created[0]).toMatchObject({ credentialHint: '9z8y' });
    expect(JSON.stringify(state.created[0])).not.toContain('sk-proj');

    state.connections = [storedKey('openai')];
    await saveWorkspaceAiConnection(ctx, 'site', { providerId: 'openai', answerModel: 'gpt-6-luna', expectedRevision: 1 });
    expect(state.updated[0]).not.toHaveProperty('credentialHint');
  });

  it('gives a short key no hint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: [{ id: 'gpt-6-luna' }, { id: 'text-embedding-3-large' }] })),
    );
    await saveWorkspaceAiConnection(ctx, 'site', { providerId: 'openai', apiKey: 'short-key-12', answerModel: 'gpt-6-luna', expectedRevision: 0 });
    expect(state.created[0]).toMatchObject({ credentialHint: null });
  });
});

describe('the contract around it', () => {
  it('still serves every field Smart AI reads today', async () => {
    const overview = await getWorkspaceAi(ctx, 'site');
    for (const field of [
      'selectedProvider',
      'answersEnabled',
      'encryptionConfigured',
      'instanceConfigured',
      'instanceAnswersEnabled',
      'embeddingModel',
      'infrastructureConfigured',
      'providers',
      'index',
      'openaiOAuth',
    ]) {
      expect(overview).toHaveProperty(field);
    }
  });

  it('decides from runtime configuration, never from a Cloud or edition flag', async () => {
    const { readFileSync } = await import('node:fs');
    const edition = /\b(isCloud|IS_CLOUD|NIBLEAF_CLOUD|NIBLEAF_EDITION|edition|isSelfHosted|SELF_HOSTED)\b/;
    for (const file of ['./ai-source.ts', './workspace-ai.ts']) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(edition);
    }
  });
});
