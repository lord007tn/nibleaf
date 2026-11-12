import { decodeEncryptionKey, encryptSecret } from '@nibleaf/shared/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ project: vi.fn(), connection: vi.fn(), update: vi.fn(async (_args: unknown) => ({ count: 1 })) }));
vi.mock('@nibleaf/database', () => ({
  prisma: { project: { findUnique: db.project }, projectIntegration: { findUnique: db.connection, updateMany: db.update } },
}));

import {
  type ChatCostSink,
  costReportingFetch,
  KEY_RETRY_AFTER_MS,
  keyHealthFetch,
  knownChatCost,
  providerKeyOutcome,
  recordProviderKeyOutcome,
  resolveWorkspaceAi,
  resolveWorkspaceAiConfiguration,
  type WorkspaceAiRuntime,
  workspaceChatModelOptions,
} from './workspace';

const key = Buffer.alloc(32, 13).toString('base64');
const encrypted = (projectId = 'workspace-a', providerId = 'openai', apiKey = 'workspace-owned-secret') =>
  encryptSecret(JSON.stringify({ kind: 'workspace-ai', projectId, providerId, apiKey }), decodeEncryptionKey(key));
const connection = (overrides = {}) => ({
  id: 'connection-a',
  revision: 1,
  status: 'ACTIVE',
  lastVerificationStatus: 'HEALTHY',
  config: { answerModel: 'gpt-test', embeddingModel: 'openai/text-embedding-3-small' },
  credentialEncrypted: encrypted(),
  ...overrides,
});

describe('workspace AI credential ownership', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OPENROUTER_API_KEY', 'instance-secret-must-not-be-used');
    vi.stubEnv('INTEGRATION_CREDENTIAL_ENCRYPTION_KEY', key);
    vi.stubEnv('INTEGRATION_CREDENTIAL_PREVIOUS_KEYS', '');
    vi.stubEnv('SEARCH_EMBEDDING_MODEL', 'openai/text-embedding-3-small');
    db.project.mockResolvedValue({ config: { search: { aiProvider: 'openai', aiAnswers: true } } });
    db.connection.mockResolvedValue(connection());
  });

  it('uses the selected workspace key instead of the instance key', async () => {
    const value = await resolveWorkspaceAi('workspace-a');
    expect(value).toMatchObject({ providerId: 'openai', apiKey: 'workspace-owned-secret', answersEnabled: true, revision: 'connection-a:1' });
    expect(db.connection).toHaveBeenCalledWith({ where: { projectId_providerId: { projectId: 'workspace-a', providerId: 'openai' } } });
  });

  it('turns off provider access without deleting the stored key', async () => {
    db.project.mockResolvedValue({ config: { search: { aiProvider: 'disabled' } } });
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
    expect(db.connection).not.toHaveBeenCalled();
  });

  it.each([null, connection({ status: 'INACTIVE' }), connection({ lastVerificationStatus: 'UNHEALTHY' })])(
    'never silently falls back for a missing or invalid workspace connection',
    async (row) => {
      db.connection.mockResolvedValue(row);
      await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
    },
  );

  it('allows only drafting to opt into the instance fallback', async () => {
    db.connection.mockResolvedValue(null);
    await expect(resolveWorkspaceAiConfiguration('workspace-a', { instanceFallback: true })).resolves.toMatchObject({
      runtime: { providerId: 'openrouter', apiKey: 'instance-secret-must-not-be-used', revision: 'instance' },
      reason: null,
    });
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
  });

  it('never overrides explicit disable even with drafting fallback enabled', async () => {
    db.project.mockResolvedValue({ config: { search: { aiProvider: 'disabled' } } });
    await expect(resolveWorkspaceAiConfiguration('workspace-a', { instanceFallback: true })).resolves.toEqual({ runtime: null, reason: 'disabled' });
    expect(db.connection).not.toHaveBeenCalled();
  });

  it('rejects a credential envelope copied from another workspace', async () => {
    db.connection.mockResolvedValue(connection({ credentialEncrypted: encrypted('workspace-b') }));
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
  });

  it('rejects a credential envelope copied from another provider', async () => {
    db.connection.mockResolvedValue(connection({ credentialEncrypted: encrypted('workspace-a', 'openrouter') }));
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
  });

  it('reads a changed credential revision on the next operation', async () => {
    const previous = await resolveWorkspaceAi('workspace-a');
    db.connection.mockResolvedValue(connection({ revision: 2, credentialEncrypted: encrypted('workspace-a', 'openai', 'new-workspace-secret') }));
    const next = await resolveWorkspaceAi('workspace-a');
    expect(previous?.revision).toBe('connection-a:1');
    expect(next).toMatchObject({ revision: 'connection-a:2', apiKey: 'new-workspace-secret' });
  });

  it('keeps search usable but refuses answers as soon as answers are switched off', async () => {
    db.project.mockResolvedValue({ config: { search: { aiProvider: 'openai', aiAnswers: false } } });
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toMatchObject({ providerId: 'openai', answersEnabled: false });
  });

  it('does not query a different embedding model against an existing index', async () => {
    db.connection.mockResolvedValue(connection({ config: { answerModel: 'gpt-test', embeddingModel: 'other/model' } }));
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
  });

  it.each([
    ['openai', { answerModel: 'gpt-test', embeddingModel: 'other/model' }],
    ['openai', { answerModel: 'gpt-test', embeddingModel: 'text-embedding-3-small' }],
    ['openrouter', { answerModel: 'site/model', embeddingModel: 'other/model' }],
  ] as const)('drafts with a healthy %s connection whose embedding model differs, but never searches with it', async (providerId, config) => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    db.project.mockResolvedValue({ config: { search: { aiProvider: providerId, aiAnswers: true } } });
    db.connection.mockResolvedValue(connection({ config, credentialEncrypted: encrypted('workspace-a', providerId) }));
    await expect(resolveWorkspaceAiConfiguration('workspace-a', { instanceFallback: true, textOnly: true })).resolves.toEqual({
      runtime: expect.objectContaining({ providerId, apiKey: 'workspace-owned-secret', answerModel: config.answerModel, revision: 'connection-a:1' }),
      reason: null,
    });
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
  });

  it.each([
    connection({ status: 'INACTIVE' }),
    connection({ lastVerificationStatus: 'UNHEALTHY' }),
    connection({ credentialEncrypted: encrypted('workspace-b') }),
    connection({ credentialEncrypted: encrypted('workspace-a', 'openrouter') }),
    connection({ config: { answerModel: 'gpt-test' } }),
  ])('keeps status, health, credential and binding checks for text-only drafting', async (row) => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    db.connection.mockResolvedValue(row);
    await expect(resolveWorkspaceAiConfiguration('workspace-a', { instanceFallback: true, textOnly: true })).resolves.toEqual({
      runtime: null,
      reason: 'not_configured',
    });
  });

  it.each([{}, null])('preserves the instance provider for an unmodified workspace with config %j', async (config) => {
    db.project.mockResolvedValue({ config });
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toMatchObject({
      providerId: 'openrouter',
      apiKey: 'instance-secret-must-not-be-used',
      revision: 'instance',
    });
  });
});

describe('workspace chat model options', () => {
  it('sets reasoning effort without sampling settings, and spares pinned models that reject it', () => {
    expect(workspaceChatModelOptions({ providerId: 'openai', answerModel: 'gpt-6-luna' })(1200)).toEqual({
      max_completion_tokens: 1200,
      reasoning_effort: 'low',
    });
    // Direct OpenAI rejects reasoning_effort on a model without reasoning; a site that pinned one keeps answering.
    expect(workspaceChatModelOptions({ providerId: 'openai', answerModel: 'gpt-pinned-chat-model' })(1200)).toEqual({ max_completion_tokens: 1200 });
    expect(workspaceChatModelOptions({ providerId: 'openrouter', answerModel: 'openai/gpt-6-luna' }, 'medium')(120)).toEqual({
      max_tokens: 120,
      reasoning: { effort: 'medium', exclude: true },
    });
  });
});

describe('OpenRouter cost reporting', () => {
  const respond = (body: string) => async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });

  it('adds usage.cost from streamed and plain responses without altering the body', async () => {
    const sink: ChatCostSink = {};
    const streamed =
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":9,"cost":0.0000078,"cost_details":{"upstream_inference_cost":0.5}}}\n\ndata: [DONE]\n\n';
    const first = await costReportingFetch(sink, respond(streamed))('https://openrouter.ai/api/v1/chat/completions');
    expect(await first.text()).toBe(streamed);
    await costReportingFetch(sink, respond('{"choices":[],"usage":{"total_tokens":3,"cost":2e-6}}'))('https://openrouter.ai/api/v1/x');
    await Promise.all(sink.pending ?? []);
    expect(sink.costUsd).toBeCloseTo(0.000_009_8, 10);
    expect(knownChatCost(sink)).toBeCloseTo(0.000_009_8, 10);
  });

  it('knows the cost only when every billed response reported one', async () => {
    const sink: ChatCostSink = {};
    await (await costReportingFetch(sink, respond('{"usage":{"total_tokens":3,"cost":0.000002}}'))('https://openrouter.ai/api/v1/x')).text();
    // A failed request is not billed and does not count.
    await costReportingFetch(sink, async () => new Response('busy', { status: 429 }))('https://openrouter.ai/api/v1/x');
    await Promise.all(sink.pending ?? []);
    expect(knownChatCost(sink)).toBeCloseTo(0.000_002, 10);
    // A stream cut off before its usage (a reader pressing Stop) was billed, at an unknown cost.
    const cut = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
        controller.error(new DOMException('Aborted', 'AbortError'));
      },
    });
    await (await costReportingFetch(sink, async () => new Response(cut, { status: 200 }))('https://openrouter.ai/api/v1/x')).text().catch(() => '');
    await Promise.all(sink.pending ?? []);
    expect(sink).toMatchObject({ calls: 2, costed: 1 });
    expect(knownChatCost(sink)).toBeUndefined();
    expect(knownChatCost({})).toBeUndefined();
  });

  it('leaves cost unknown when the provider reports none', async () => {
    const sink: ChatCostSink = {};
    await (await costReportingFetch(sink, respond('{"usage":{"total_tokens":3}}'))('https://example.test')).text();
    await Promise.all(sink.pending ?? []);
    expect(sink.costUsd).toBeUndefined();
    expect(knownChatCost(sink)).toBeUndefined();
  });
});

describe("a site's own key follows what its requests get (#566 council)", () => {
  beforeEach(() => vi.clearAllMocks());
  const runtime = (overrides = {}) => ({
    providerId: 'openai' as const,
    apiKey: 'workspace-owned-secret',
    answerModel: 'gpt-test',
    embeddingModel: 'openai/text-embedding-3-small',
    revision: 'connection-a:7',
    answersEnabled: true,
    ...overrides,
  });
  const reply = (status: number, body: unknown = {}) => Response.json(body, { status });
  const settled = () => new Promise((done) => setTimeout(done, 0));

  it.each([
    { status: 200, body: {}, outcome: 'ok' },
    { status: 401, body: {}, outcome: 'keyRefused' },
    { status: 403, body: {}, outcome: 'keyRefused' },
    { status: 402, body: {}, outcome: 'outOfCredit' },
    { status: 429, body: { error: { code: 'insufficient_quota' } }, outcome: 'outOfCredit' },
    { status: 429, body: { error: { code: 'rate_limit_exceeded' } }, outcome: 'rateLimited' },
    { status: 500, body: {}, outcome: 'other' },
  ])('reads $status as $outcome, leaving the body for the caller', async ({ status, body, outcome }) => {
    const response = reply(status, body);
    await expect(providerKeyOutcome(response)).resolves.toBe(outcome);
    await expect(response.json()).resolves.toEqual(body);
  });

  it('marks a refused or out-of-credit key, only at the revision that was used, restarting its rest each time', async () => {
    await recordProviderKeyOutcome('connection-a:7', 'keyRefused');
    await recordProviderKeyOutcome('connection-a:7', 'outOfCredit');
    expect(db.update.mock.calls.map(([call]) => call)).toEqual([
      {
        where: { id: 'connection-a', revision: 7 },
        data: { lastVerificationStatus: 'UNHEALTHY', lastVerificationCode: 'integration:credentials_invalid', lastVerifiedAt: expect.any(Date) },
      },
      {
        where: { id: 'connection-a', revision: 7 },
        data: { lastVerificationStatus: 'UNHEALTHY', lastVerificationCode: 'integration:quota_exhausted', lastVerifiedAt: expect.any(Date) },
      },
    ]);
  });

  it('notes a rate limit without stopping the key, and clears it once a request gets through', async () => {
    await recordProviderKeyOutcome('connection-a:7', 'rateLimited');
    await recordProviderKeyOutcome('connection-a:7', 'ok');
    expect(db.update.mock.calls.map(([call]) => call)).toEqual([
      {
        where: { id: 'connection-a', revision: 7, lastVerificationStatus: 'HEALTHY' },
        data: { lastVerificationCode: 'integration:rate_limited', lastVerifiedAt: expect.any(Date) },
      },
      {
        where: {
          id: 'connection-a',
          revision: 7,
          OR: [
            { lastVerificationStatus: 'HEALTHY', lastVerificationCode: 'integration:rate_limited' },
            { lastVerificationStatus: 'UNHEALTHY', lastVerificationCode: { in: ['integration:credentials_invalid', 'integration:quota_exhausted'] } },
          ],
        },
        data: { lastVerificationStatus: 'HEALTHY', lastVerificationCode: null, lastVerifiedAt: expect.any(Date) },
      },
    ]);
  });

  it("never records anything for the server's own key or a passing provider error", async () => {
    await recordProviderKeyOutcome('instance', 'keyRefused');
    await recordProviderKeyOutcome('connection-a:7', 'other');
    expect(db.update).not.toHaveBeenCalled();
    expect(keyHealthFetch(runtime({ revision: 'instance' }))).toBeUndefined();
  });

  it('records what a reader request learns, without changing what the reader gets', async () => {
    const fetcher = keyHealthFetch(runtime(), async () => reply(401, { error: 'nope' }));
    const response = await fetcher?.('https://api.openai.com/v1/chat/completions');
    await expect(response?.json()).resolves.toEqual({ error: 'nope' });
    await settled();
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastVerificationCode: 'integration:credentials_invalid' }) }),
    );
  });

  it('writes nothing for a success unless a rate limit is on record', async () => {
    await keyHealthFetch(runtime(), async () => reply(200))?.('https://api.openai.com/v1/embeddings');
    await settled();
    expect(db.update).not.toHaveBeenCalled();
    await keyHealthFetch(runtime({ recovering: true }), async () => reply(200))?.('https://api.openai.com/v1/embeddings');
    await settled();
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastVerificationCode: null }) }));
  });

  it('carries a recorded rate limit into the runtime, so the next success clears it', async () => {
    vi.stubEnv('INTEGRATION_CREDENTIAL_ENCRYPTION_KEY', key);
    vi.stubEnv('INTEGRATION_CREDENTIAL_PREVIOUS_KEYS', '');
    vi.stubEnv('SEARCH_EMBEDDING_MODEL', 'openai/text-embedding-3-small');
    db.project.mockResolvedValue({ config: { search: { aiProvider: 'openai', aiAnswers: true } } });
    db.connection.mockResolvedValue(connection({ lastVerificationCode: 'integration:rate_limited' }));
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toMatchObject({ recovering: true });
    vi.unstubAllEnvs();
  });
});

describe('a refusal rests the key, then readers try it again (#566 council)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('INTEGRATION_CREDENTIAL_ENCRYPTION_KEY', key);
    vi.stubEnv('INTEGRATION_CREDENTIAL_PREVIOUS_KEYS', '');
    vi.stubEnv('SEARCH_EMBEDDING_MODEL', 'openai/text-embedding-3-small');
    db.project.mockResolvedValue({ config: { search: { aiProvider: 'openai', aiAnswers: true } } });
  });
  afterEach(() => vi.unstubAllEnvs());
  const refused = (minutesAgo: number, code = 'integration:credentials_invalid') =>
    connection({ lastVerificationStatus: 'UNHEALTHY', lastVerificationCode: code, lastVerifiedAt: new Date(Date.now() - minutesAgo * 60_000) });
  const reply = (status: number) => Response.json({}, { status });
  const settled = () => new Promise((done) => setTimeout(done, 0));

  it('refused, blocked during the rest, retried after it, cleared by a success; a fresh refusal rests it again', async () => {
    // Refused just now: readers get "answers unavailable", not the key.
    db.connection.mockResolvedValue(refused(1));
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
    // Rested for longer than KEY_RETRY_AFTER_MS: the next request tries it again.
    expect(KEY_RETRY_AFTER_MS).toBe(15 * 60_000);
    db.connection.mockResolvedValue(refused(16));
    const retried = (await resolveWorkspaceAi('workspace-a')) as WorkspaceAiRuntime;
    expect(retried).toMatchObject({ apiKey: 'workspace-owned-secret', recovering: true });
    // It works again: the record is cleared.
    await keyHealthFetch(retried, async () => reply(200))?.('https://api.openai.com/v1/chat/completions');
    await settled();
    expect(db.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { lastVerificationStatus: 'HEALTHY', lastVerificationCode: null, lastVerifiedAt: expect.any(Date) } }),
    );
    // Refused again instead: the rest starts over.
    await keyHealthFetch(retried, async () => reply(401))?.('https://api.openai.com/v1/chat/completions');
    await settled();
    expect(db.update).toHaveBeenLastCalledWith({
      where: { id: 'connection-a', revision: 1 },
      data: { lastVerificationStatus: 'UNHEALTHY', lastVerificationCode: 'integration:credentials_invalid', lastVerifiedAt: expect.any(Date) },
    });
  });

  it('an out-of-credit key rests the same way', async () => {
    db.connection.mockResolvedValue(refused(1, 'integration:quota_exhausted'));
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
    db.connection.mockResolvedValue(refused(16, 'integration:quota_exhausted'));
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toMatchObject({ recovering: true });
  });

  it('other failures (a withdrawn model, a switched-off key) still wait for a check', async () => {
    db.connection.mockResolvedValue(refused(60, 'integration:model_unavailable'));
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
    db.connection.mockResolvedValue({ ...refused(60), status: 'INACTIVE' });
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
  });
});
