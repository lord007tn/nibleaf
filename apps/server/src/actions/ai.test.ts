import { decodeEncryptionKey, encryptSecret } from '@nibleaf/shared/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  create: vi.fn(),
  router: vi.fn(),
  openai: vi.fn(),
  project: vi.fn(),
  connection: vi.fn(),
  exhausted: vi.fn(),
  env: { AI_DRAFT_MODEL: 'openai/instance-draft', OPENROUTER_API_KEY: 'instance-secret' as string | undefined },
  extras: { AI_DAILY_LIMIT: 50 },
}));
vi.mock('@nibleaf/database', () => ({ prisma: { project: { findUnique: mocks.project }, projectIntegration: { findUnique: mocks.connection } } }));
vi.mock('@openrouter/sdk', () => ({
  OpenRouter: class {
    constructor(options: unknown) {
      mocks.router(options);
    }
    chat = { send: mocks.send };
  },
}));
vi.mock('openai', () => ({
  default: class {
    constructor(options: unknown) {
      mocks.openai(options);
    }
    chat = { completions: { create: mocks.create } };
  },
}));
vi.mock('@/env', () => ({ env: mocks.env }));
vi.mock('@/lib/env-extras', () => ({ envExtras: mocks.extras }));
vi.mock('@/lib/ai-quota', () => ({ isAiQuotaExhausted: mocks.exhausted }));

import { aiDraftAvailable, draftContentWithTelemetry, getAiDraftCapability, resolveAiDraft } from './ai';

const encryptionKey = Buffer.alloc(32, 13).toString('base64');
const select = (provider = 'openai') => {
  mocks.project.mockResolvedValue({ config: { search: { aiProvider: provider, aiAnswers: false } } });
  mocks.connection.mockResolvedValue({
    id: 'connection',
    revision: 2,
    status: 'ACTIVE',
    lastVerificationStatus: 'HEALTHY',
    config: { answerModel: provider === 'openai' ? 'gpt-site' : 'openai/site-model', embeddingModel: 'openai/text-embedding-3-small' },
    credentialEncrypted: encryptSecret(
      JSON.stringify({ kind: 'workspace-ai', projectId: 'site', providerId: provider, apiKey: 'site-secret' }),
      decodeEncryptionKey(encryptionKey),
    ),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPENROUTER_API_KEY', 'instance-secret');
  vi.stubEnv('INTEGRATION_CREDENTIAL_ENCRYPTION_KEY', encryptionKey);
  vi.stubEnv('INTEGRATION_CREDENTIAL_PREVIOUS_KEYS', '');
  vi.stubEnv('SEARCH_EMBEDDING_MODEL', 'openai/text-embedding-3-small');
  mocks.env.OPENROUTER_API_KEY = 'instance-secret';
  mocks.extras.AI_DAILY_LIMIT = 50;
  mocks.exhausted.mockResolvedValue(false);
  mocks.send.mockResolvedValue({
    choices: [{ message: { content: '  Improved documentation.  ' } }],
    usage: { promptTokens: 12, completionTokens: 4 },
  });
  mocks.create.mockResolvedValue({
    choices: [{ message: { content: '  Improved documentation.  ' } }],
    usage: { prompt_tokens: 12, completion_tokens: 4 },
  });
  select();
});
afterEach(() => vi.unstubAllEnvs());

describe('project drafting capability', () => {
  it.each(['openai', 'openrouter'])('reports the selected workspace %s connection without secrets', async (provider) => {
    select(provider);
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const capability = await getAiDraftCapability('site', 'org');
    expect(capability).toEqual({ available: true, source: 'workspace', provider, reason: null });
    expect(JSON.stringify(capability)).not.toMatch(/secret|apiKey|model|revision|connection/);
    expect(mocks.exhausted).toHaveBeenCalledWith('org');
  });
  it('reports the instance OpenRouter connection', async () => {
    mocks.project.mockResolvedValue({ config: {} });
    expect(await getAiDraftCapability('site', 'org')).toEqual({ available: true, source: 'instance', provider: 'openrouter', reason: null });
  });
  it('reports not configured when neither source is usable', async () => {
    mocks.connection.mockResolvedValue(null);
    vi.stubEnv('OPENROUTER_API_KEY', '');
    expect(await getAiDraftCapability('site', 'org')).toEqual({ available: false, source: null, provider: null, reason: 'not_configured' });
    expect(mocks.exhausted).not.toHaveBeenCalled();
  });
  it('respects explicit site disable even with both keys present', async () => {
    mocks.project.mockResolvedValue({ config: { search: { aiProvider: 'disabled' } } });
    expect(await getAiDraftCapability('site', 'org')).toEqual({ available: false, source: null, provider: null, reason: 'disabled' });
    expect(mocks.connection).not.toHaveBeenCalled();
  });
  it('reports disabled when the daily limit is zero', async () => {
    mocks.extras.AI_DAILY_LIMIT = 0;
    expect(await getAiDraftCapability('site', 'org')).toEqual({ available: false, source: null, provider: null, reason: 'disabled' });
    expect(mocks.exhausted).not.toHaveBeenCalled();
  });
  it('reports quota while retaining the connection identity', async () => {
    mocks.exhausted.mockResolvedValue(true);
    expect(await getAiDraftCapability('site', 'org')).toEqual({ available: false, source: 'workspace', provider: 'openai', reason: 'quota' });
  });
  it('reports quota read failures as unavailable while retaining the connection identity', async () => {
    mocks.exhausted.mockRejectedValue(new AppError({ code: 'usage:unavailable' }));
    await expect(getAiDraftCapability('site', 'org')).resolves.toEqual({
      available: false,
      source: 'workspace',
      provider: 'openai',
      reason: 'quota_unavailable',
    });
  });
  it('does not misclassify unexpected quota errors as a known capability state', async () => {
    mocks.exhausted.mockRejectedValue(new Error('unexpected failure'));
    await expect(getAiDraftCapability('site', 'org')).rejects.toThrow('unexpected failure');
  });
});

describe('drafting with the resolved connection', () => {
  it.each(['openai', 'openrouter'])('sends the site key to %s and records secret-free telemetry', async (provider) => {
    select(provider);
    const { runtime } = await resolveAiDraft('site');
    if (!runtime) throw new Error('Expected runtime');
    const result = await draftContentWithTelemetry({ mode: 'rephrase', content: 'Draft' }, runtime);
    expect(result).toMatchObject({ text: 'Improved documentation.', source: 'workspace', provider, promptTokens: 12, completionTokens: 4 });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(provider === 'openai' ? mocks.openai : mocks.router).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'site-secret' }));
    expect(provider === 'openai' ? mocks.router : mocks.openai).not.toHaveBeenCalled();
    if (provider === 'openai') expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-site' }));
    else expect(mocks.send).toHaveBeenCalledWith({ chatRequest: expect.objectContaining({ model: 'openai/site-model', stream: false }) });
  });
  it.each(['openai', 'openrouter'])('keeps the %s SDK timeout independent of the search timeout', async (provider) => {
    vi.stubEnv('SEARCH_ANSWER_TIMEOUT_MS', '1000');
    select(provider);
    const { runtime } = await resolveAiDraft('site');
    if (!runtime) throw new Error('Expected runtime');
    await draftContentWithTelemetry({ mode: 'continue', content: 'Long guide' }, runtime);
    const options = (provider === 'openai' ? mocks.openai : mocks.router).mock.calls[0]?.[0];
    expect(options).not.toHaveProperty('timeout');
    expect(options).not.toHaveProperty('timeoutMs');
  });
  it.each(['instance', 'missing-workspace'])('uses the instance key and draft model for %s', async (selection) => {
    if (selection === 'instance') mocks.project.mockResolvedValue({ config: {} });
    else mocks.connection.mockResolvedValue(null);
    const { runtime } = await resolveAiDraft('site');
    if (!runtime) throw new Error('Expected runtime');
    expect(await draftContentWithTelemetry({ mode: 'outline', content: 'API guide' }, runtime)).toMatchObject({
      source: 'instance',
      provider: 'openrouter',
      model: 'openai/instance-draft',
    });
    expect(mocks.router).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'instance-secret' }));
    expect(mocks.send).toHaveBeenCalledWith({ chatRequest: expect.objectContaining({ model: 'openai/instance-draft' }) });
  });
  it('propagates provider failures without trying the instance key', async () => {
    mocks.create.mockRejectedValue(new Error('provider unavailable'));
    const { runtime } = await resolveAiDraft('site');
    if (!runtime) throw new Error('Expected runtime');
    await expect(draftContentWithTelemetry({ mode: 'outline', content: 'API guide' }, runtime)).rejects.toThrow('provider unavailable');
    expect(mocks.router).not.toHaveBeenCalled();
  });
  it('rejects empty provider output', async () => {
    mocks.create.mockResolvedValue({ choices: [] });
    const { runtime } = await resolveAiDraft('site');
    if (!runtime) throw new Error('Expected runtime');
    await expect(draftContentWithTelemetry({ mode: 'outline', content: 'API guide' }, runtime)).rejects.toThrow('empty completion');
  });
  it('rejects unexpected OpenRouter streaming output', async () => {
    select('openrouter');
    mocks.send.mockResolvedValue({});
    const { runtime } = await resolveAiDraft('site');
    if (!runtime) throw new Error('Expected runtime');
    await expect(draftContentWithTelemetry({ mode: 'outline', content: 'API guide' }, runtime)).rejects.toThrow('unexpected streaming completion');
  });
});

it('keeps the legacy public instance-wide flag unchanged', () => {
  expect(aiDraftAvailable()).toBe(true);
  mocks.extras.AI_DAILY_LIMIT = 0;
  expect(aiDraftAvailable()).toBe(false);
  mocks.extras.AI_DAILY_LIMIT = 50;
  mocks.env.OPENROUTER_API_KEY = undefined;
  expect(aiDraftAvailable()).toBe(false);
});
