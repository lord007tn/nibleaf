import { decodeEncryptionKey, encryptSecret } from '@nibleaf/shared/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ project: vi.fn(), connection: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: { project: { findUnique: db.project }, projectIntegration: { findUnique: db.connection } } }));

import { costReportingFetch, resolveWorkspaceAi, workspaceChatModelOptions } from './workspace';

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
  it('never sends temperature to direct OpenAI, matching the answer provider', () => {
    expect(workspaceChatModelOptions({ providerId: 'openai' })(1200)).toEqual({ max_completion_tokens: 1200 });
    expect(workspaceChatModelOptions({ providerId: 'openrouter' })(120)).toEqual({ temperature: 0, max_tokens: 120 });
  });
});

describe('OpenRouter cost reporting', () => {
  const respond = (body: string) => async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });

  it('adds usage.cost from streamed and plain responses without altering the body', async () => {
    const sink: { costUsd?: number; pending?: Promise<void>[] } = {};
    const streamed =
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":9,"cost":0.0000078,"cost_details":{"upstream_inference_cost":0.5}}}\n\ndata: [DONE]\n\n';
    const first = await costReportingFetch(sink, respond(streamed))('https://openrouter.ai/api/v1/chat/completions');
    expect(await first.text()).toBe(streamed);
    await costReportingFetch(sink, respond('{"choices":[],"usage":{"total_tokens":3,"cost":2e-6}}'))('https://openrouter.ai/api/v1/x');
    await Promise.all(sink.pending ?? []);
    expect(sink.costUsd).toBeCloseTo(0.000_009_8, 10);
  });

  it('leaves cost unknown when the provider reports none', async () => {
    const sink: { costUsd?: number; pending?: Promise<void>[] } = {};
    await (await costReportingFetch(sink, respond('{"usage":{"total_tokens":3}}'))('https://example.test')).text();
    await Promise.all(sink.pending ?? []);
    expect(sink.costUsd).toBeUndefined();
  });
});
