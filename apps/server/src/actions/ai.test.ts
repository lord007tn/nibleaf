import { decodeEncryptionKey, encryptSecret } from '@nibleaf/shared/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  project: vi.fn(),
  connection: vi.fn(),
  exhausted: vi.fn(),
  env: { AI_DRAFT_MODEL: 'openai/instance-draft', OPENROUTER_API_KEY: 'instance-secret' as string | undefined },
  extras: { AI_DAILY_LIMIT: 50 },
}));
vi.mock('@nibleaf/database', () => ({ prisma: { project: { findUnique: mocks.project }, projectIntegration: { findUnique: mocks.connection } } }));
vi.mock('@nibleaf/search/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/search/workspace')>()),
  completeWorkspaceText: mocks.complete,
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
  mocks.complete.mockResolvedValue({ text: '  Improved documentation.  ', promptTokens: 12, completionTokens: 4 });
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
    expect(await getAiDraftCapability('site', 'org')).toEqual({ available: false, source: null, provider: null, reason: 'site_disabled' });
    expect(mocks.connection).not.toHaveBeenCalled();
  });
  it('reports disabled when the daily limit is zero', async () => {
    mocks.extras.AI_DAILY_LIMIT = 0;
    expect(await getAiDraftCapability('site', 'org')).toEqual({ available: false, source: null, provider: null, reason: 'instance_disabled' });
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
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'site-secret', providerId: provider, answerModel: provider === 'openai' ? 'gpt-site' : 'openai/site-model' }),
      [expect.objectContaining({ role: 'system' }), { role: 'user', content: expect.stringContaining('Draft') }],
      expect.any(Object),
    );
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
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'instance-secret', answerModel: 'openai/instance-draft' }),
      expect.any(Array),
      expect.any(Object),
    );
  });
  it('propagates provider failures without trying the instance key', async () => {
    mocks.complete.mockRejectedValue(new Error('provider unavailable'));
    const { runtime } = await resolveAiDraft('site');
    if (!runtime) throw new Error('Expected runtime');
    await expect(draftContentWithTelemetry({ mode: 'outline', content: 'API guide' }, runtime)).rejects.toThrow('provider unavailable');
    expect(mocks.complete).toHaveBeenCalledOnce();
  });
  it('rejects empty provider output', async () => {
    mocks.complete.mockResolvedValue({ text: '' });
    const { runtime } = await resolveAiDraft('site');
    if (!runtime) throw new Error('Expected runtime');
    await expect(draftContentWithTelemetry({ mode: 'outline', content: 'API guide' }, runtime)).rejects.toThrow('empty completion');
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
