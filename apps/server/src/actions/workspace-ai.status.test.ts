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
  usage: { answersToday: 37 as number | null, spent: 40 as number | null, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' },
  connections: [] as Record<string, unknown>[],
  deployment: null as Record<string, unknown> | null,
  /** The current deployment's run, built for the current settings unless it says otherwise. */
  run: null as Record<string, unknown> | null,
  /** More runs, e.g. one built for another embedding model. */
  otherRuns: [] as Record<string, unknown>[],
  /** What the search alias serves (see readiness.ts `servedIndexState`); null when there is no search. */
  served: 'serving' as 'serving' | 'empty' | 'other' | 'unreadable' | null,
  role: 'admin',
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
  QDRANT_COLLECTION_VERSION: 'v2',
  SEARCH_EMBEDDING_DIMENSIONS: 3072,
};

/** Runs as the database would hold them: the current one gets the current settings by default. */
const allRuns = () => [
  ...(state.run
    ? [
        {
          projectId: 'site',
          deploymentId: 'deployment-12',
          schemaVersion: state.env.QDRANT_COLLECTION_VERSION,
          embeddingModel: state.env.SEARCH_EMBEDDING_MODEL,
          vectorSize: state.env.SEARCH_EMBEDDING_DIMENSIONS,
          expectedPages: 128,
          failedChunks: 0,
          createdAt: new Date('2026-11-11T08:00:00.000Z'),
          ...state.run,
        },
      ]
    : []),
  ...state.otherRuns,
];

vi.mock('@/env', () => ({
  get env() {
    return state.env;
  },
}));
vi.mock('@nibleaf/search/keys', () => ({
  keys: () => ({
    SEARCH_ANSWER_ENABLED: state.env.SEARCH_ANSWER_ENABLED,
    SEARCH_EMBEDDING_MODEL: state.env.SEARCH_EMBEDDING_MODEL,
    SEARCH_ANSWER_DAILY_PER_PROJECT: state.env.SEARCH_ANSWER_DAILY_PER_PROJECT,
  }),
}));
vi.mock('@nibleaf/qdrant', () => ({ getQdrantClient: () => (state.qdrant ? {} : null) }));
vi.mock('@/lib/ai-search/quota', () => ({ readAnswerQuota: vi.fn(async () => state.usage) }));
// The real matching-run predicate; only the cached alias reading is stubbed.
vi.mock('@/lib/ai-search/readiness', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai-search/readiness')>()),
  servedIndexState: async () => state.served,
}));
vi.mock('@nibleaf/database', () => ({
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  prisma: {
    projectIntegration: {
      findMany: async () => state.connections,
      findUnique: async ({ where }: { where: { projectId_providerId: { providerId: string } } }) =>
        state.connections.find((row) => row.providerId === where.projectId_providerId.providerId) ?? null,
    },
    deployment: { findFirst: async () => state.deployment },
    // Honours the query's where (equality on each field), newest first, like the database.
    searchIndexRun: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        allRuns()
          .filter((run) => Object.entries(where).every(([field, value]) => (run as Record<string, unknown>)[field] === value))
          .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0] ?? null,
    },
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
  assertProjectAccess: async () => ({ role: state.role, organizationId: 'org', project: { id: 'site', config: state.config } }),
}));
vi.mock('./project-config', () => ({ updateProjectConfigSection: vi.fn() }));
vi.mock('./sites', () => ({ invalidatePublishedSiteConfig: vi.fn() }));

import { encryptIntegrationSecret } from './integrations/crypto';
import { getWorkspaceAi, saveWorkspaceAiConnection, selectWorkspaceAi } from './workspace-ai';

const ctx = { get: (key: string) => (key === 'user' ? { id: 'admin-user' } : undefined) } as unknown as Context<HonoEnv>;

/**
 * The body of every fake API key here, assembled at runtime so no key-shaped
 * literal reaches the repository (secret scanners read test files too).
 */
const FAKE_KEY = ['sk', 'test', 'x'.repeat(24)].join('-');
/** A fake key that ends in `last4`, long enough to get a hint. */
const fakeKey = (last4: string) => `${FAKE_KEY}${last4}`;
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
  credentialEncrypted: encryptIntegrationSecret(JSON.stringify({ kind: 'workspace-ai', projectId: 'site', providerId, apiKey: fakeKey('4f2a') })),
  credentialHint: '4f2a',
  credentialAddedAt: created,
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
  state.usage = { answersToday: 37, spent: 40, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' };
  state.connections = [];
  state.deployment = { id: 'deployment-12', version: 12, completedAt: new Date('2026-11-11T08:00:00.000Z') };
  state.run = { status: 'READY', errorCode: null, indexedPages: 128, indexedChunks: 900, completedAt: new Date('2026-11-11T08:05:00.000Z') };
  state.otherRuns = [];
  state.served = 'serving';
  state.role = 'admin';
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
    state.served = null;
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
      preparation: { state: 'ready', pages: 128, expectedPages: 128, at: '2026-11-11T08:05:00.000Z' },
      usage: { answersToday: 37, spent: 40, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' },
    });
  });

  it('reports a site key by its hint, date and model name', async () => {
    state.config = { search: { aiProvider: 'openai', aiAnswers: true } };
    state.connections = [storedKey('openai')];
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status).toMatchObject({ answersOn: true, source: 'openai', sourceReady: true });
    expect(status.connections).toEqual([
      {
        id: 'openai',
        revision: 1,
        state: 'ok',
        failure: null,
        keyHint: '4f2a',
        addedAt: '2026-11-10T09:00:00.000Z',
        model: { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
      },
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
    state.usage = { answersToday: null, spent: null, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' };
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status.usage.answersToday).toBeNull();
  });
});

describe('secrets', () => {
  it('never returns a key, a key prefix, a ciphertext or the server key', async () => {
    state.config = { search: { aiProvider: 'openrouter', aiAnswers: true } };
    state.connections = [storedKey('openai'), storedKey('openrouter')];
    const body = JSON.stringify(await getWorkspaceAi(ctx, 'site'));
    for (const secret of [fakeKey('4f2a'), FAKE_KEY, 'sk-', 'operator-secret-key', storedKey('openai').credentialEncrypted]) {
      expect(body).not.toContain(secret);
    }
  });

  it('stores only the last four characters of a newly saved key, and keeps the hint when the key is kept', async () => {
    const apiKey = fakeKey('9z8y');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: [{ id: 'gpt-6-luna' }, { id: 'text-embedding-3-large' }] })),
    );

    await saveWorkspaceAiConnection(ctx, 'site', { providerId: 'openai', apiKey, answerModel: 'gpt-6-luna', expectedRevision: 0 });
    expect(state.created[0]).toMatchObject({ credentialHint: '9z8y' });
    expect(JSON.stringify(state.created[0])).not.toContain(FAKE_KEY);

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
    // Code only (comments may explain the rule); any identifier or token that
    // names a deployment kind fails: isCloud, NIBLEAF_EDITION, selfHosted, isHosted…
    const tokens = (source: string) =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .match(/[A-Za-z_$][\w$]*/g) ?? [];
    const edition = /cloud|edition|ishosted|selfhost/i;
    for (const file of ['./ai-source.ts', './workspace-ai.ts', '../lib/ai-search/readiness.ts', '../lib/ai-search/quota.ts']) {
      expect(tokens(readFileSync(new URL(file, import.meta.url), 'utf8')).filter((token) => edition.test(token))).toEqual([]);
    }
  });
});

describe("the reader's readiness", () => {
  it('ignores a run built for another embedding model, as the reader does', async () => {
    state.run = null;
    state.otherRuns = [
      {
        projectId: 'site',
        deploymentId: 'deployment-12',
        schemaVersion: 'v2',
        embeddingModel: 'openai/text-embedding-3-small',
        vectorSize: 1536,
        status: 'READY',
        indexedPages: 128,
        indexedChunks: 900,
        expectedPages: 128,
        failedChunks: 0,
        completedAt: new Date('2026-11-11T09:00:00.000Z'),
        createdAt: new Date('2026-11-11T09:00:00.000Z'),
      },
    ];
    state.config = { search: { aiAnswers: true } };
    const overview = await getWorkspaceAi(ctx, 'site');
    expect(overview.status.preparation.state).toBe('none');
    // Smart AI reads the same run, so it can't say "ready" either.
    expect(overview.index).toMatchObject({ status: null, chunks: 0 });
  });

  it('uses the current run even when a newer run was built for other settings', async () => {
    state.otherRuns = [
      {
        projectId: 'site',
        deploymentId: 'deployment-12',
        schemaVersion: 'v2',
        embeddingModel: 'openai/text-embedding-3-small',
        vectorSize: 1536,
        status: 'FAILED',
        indexedPages: 0,
        indexedChunks: 0,
        expectedPages: 128,
        failedChunks: 0,
        completedAt: null,
        createdAt: new Date('2026-11-11T10:00:00.000Z'),
      },
    ];
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status.preparation).toMatchObject({ state: 'ready', pages: 128 });
  });

  it('reports answers unavailable while search serves a collection built for other settings', async () => {
    state.served = 'other';
    const { capabilities } = await getWorkspaceAi(ctx, 'site');
    expect(capabilities.answers).toEqual({ available: false, reason: 'searchIndexSwitching' });
  });

  it.each([
    { name: 'some chunks failed', run: { failedChunks: 3 }, expected: 'partial' },
    { name: 'fewer pages than expected', run: { indexedPages: 120 }, expected: 'partial' },
    { name: 'everything prepared', run: {}, expected: 'ready' },
  ])('marks preparation partial when $name', async ({ run, expected }) => {
    state.run = { ...state.run, ...run };
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status.preparation).toMatchObject({ state: expected, expectedPages: 128 });
  });
});

describe('a key whose last check failed', () => {
  it.each([
    { code: 'integration:credentials_invalid', keyState: 'rejected', reason: 'keyRefused' },
    { code: 'integration:provider_unavailable', keyState: 'unreachable', reason: 'providerUnreachable' },
    { code: 'integration:model_unavailable', keyState: 'modelWithdrawn', reason: 'modelWithdrawn' },
    { code: `provider said: invalid key ${FAKE_KEY}leaked`, keyState: 'rejected', reason: 'checkFailed' },
  ])('$code → $keyState ($reason), as a code with its time', async ({ code, keyState, reason }) => {
    state.config = { search: { aiProvider: 'openai', aiAnswers: true } };
    state.connections = [storedKey('openai', { lastVerificationStatus: 'UNHEALTHY', lastVerificationCode: code })];
    const overview = await getWorkspaceAi(ctx, 'site');
    expect(overview.status.connections[0]).toMatchObject({
      state: keyState,
      failure: { reason, checkedAt: '2026-11-10T09:00:00.000Z' },
    });
    expect(overview.status.sourceReady).toBe(false);
    // Provider text is never passed through.
    expect(JSON.stringify(overview)).not.toContain('leaked');
  });
});

describe('the date a key was added', () => {
  const models = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: [{ id: 'gpt-6-luna' }, { id: 'text-embedding-3-large' }] })),
    );

  it('is the date of the current key, not of the connection', async () => {
    state.connections = [storedKey('openai', { credentialAddedAt: new Date('2026-11-11T12:00:00.000Z') })];
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status.connections[0]?.addedAt).toBe('2026-11-11T12:00:00.000Z');
  });

  it('is set when a key is added or replaced, and kept on a model-only save', async () => {
    models();
    await saveWorkspaceAiConnection(ctx, 'site', {
      providerId: 'openai',
      apiKey: fakeKey('0001'),
      answerModel: 'gpt-6-luna',
      expectedRevision: 0,
    });
    expect(state.created[0]?.credentialAddedAt).toBeInstanceOf(Date);

    state.connections = [storedKey('openai')];
    await saveWorkspaceAiConnection(ctx, 'site', {
      providerId: 'openai',
      apiKey: fakeKey('0002'),
      replaceCredential: true,
      answerModel: 'gpt-6-luna',
      expectedRevision: 1,
    });
    expect(state.updated[0]?.credentialAddedAt).toBeInstanceOf(Date);

    await saveWorkspaceAiConnection(ctx, 'site', { providerId: 'openai', answerModel: 'gpt-6-luna', expectedRevision: 1 });
    expect(state.updated[1]).not.toHaveProperty('credentialAddedAt');
  });
});

describe('who may read and who may change', () => {
  it.each([
    { role: 'viewer', canManage: false },
    { role: 'member', canManage: false },
    { role: 'admin', canManage: true },
    { role: 'owner', canManage: true },
  ])('a site $role reads the overview (may change: $canManage)', async ({ role, canManage }) => {
    state.role = role;
    state.connections = [storedKey('openai')];
    const overview = await getWorkspaceAi(ctx, 'site');
    expect(overview.viewer).toEqual({ canManage });
    // The key hint is for the people who manage keys.
    expect(overview.status.connections[0]?.keyHint).toBe(canManage ? '4f2a' : null);
  });

  it.each(['viewer', 'member'])('a site %s cannot change AI settings or keys', async (role) => {
    state.role = role;
    await expect(selectWorkspaceAi(ctx, 'site', { providerId: 'disabled', answersEnabled: false })).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });
    await expect(
      saveWorkspaceAiConnection(ctx, 'site', {
        providerId: 'openai',
        apiKey: fakeKey('0003'),
        answerModel: 'gpt-6-luna',
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: 'auth:insufficient_role' });
  });

  it('refuses API keys even for reading', async () => {
    const apiKeyCtx = {
      get: (key: string) => (key === 'apiKey' ? { id: 'key' } : key === 'user' ? { id: 'admin-user' } : undefined),
    } as unknown as Context<HonoEnv>;
    await expect(getWorkspaceAi(apiKeyCtx, 'site')).rejects.toMatchObject({ code: 'auth:insufficient_role' });
  });
});

describe('CodeRabbit review on #513', () => {
  it.each([
    { served: 'empty', name: 'a new server before its first index job' },
    { served: 'unreadable', name: 'a search alias that could not be read just now' },
  ] as const)('lets settings prepare answers on $name (the reader stays fail-closed)', async ({ served }) => {
    state.served = served;
    state.run = null;
    const overview = await getWorkspaceAi(ctx, 'site');
    expect(overview.capabilities.answers).toEqual({ available: true, reason: null });
    expect(overview.status.preparation.state).toBe('none');
  });

  it('decides the limit from the spent quota: failed generations can exhaust it with few answers completed', async () => {
    state.usage = { answersToday: 0, spent: 200, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' };
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status.usage).toEqual({ answersToday: 0, spent: 200, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' });
  });

  it('reports Nibleaf AI unavailable when the daily answer limit is 0', async () => {
    state.env.SEARCH_ANSWER_DAILY_PER_PROJECT = 0;
    state.config = { search: { aiAnswers: true } };
    const overview = await getWorkspaceAi(ctx, 'site');
    expect(overview.capabilities.managed).toMatchObject({ available: false, reason: 'noDailyAnswers', dailyAnswerLimit: 0 });
    expect(overview.status.sourceReady).toBe(false);
  });

  it('leaves the added date unknown for a key saved before it was recorded', async () => {
    state.connections = [storedKey('openai', { credentialAddedAt: null })];
    const { status } = await getWorkspaceAi(ctx, 'site');
    expect(status.connections[0]?.addedAt).toBeNull();
  });
});
