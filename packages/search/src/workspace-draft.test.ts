import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), create: vi.fn(), router: vi.fn(), openai: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: {} }));
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

import { completeWorkspaceText, type WorkspaceAiRuntime } from './workspace';

const runtime = (providerId: 'openai' | 'openrouter'): WorkspaceAiRuntime => ({
  apiKey: 'site-secret',
  providerId,
  answerModel: 'site-model',
  embeddingModel: 'embedding',
  revision: 'site:1',
  answersEnabled: true,
});
const messages = [{ role: 'user' as const, content: 'Synthetic guide' }];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SEARCH_ANSWER_TIMEOUT_MS', '1000');
  mocks.send.mockResolvedValue({ choices: [{ message: { content: 'Draft' } }], usage: { promptTokens: 12, completionTokens: 4 } });
  mocks.create.mockResolvedValue({ choices: [{ message: { content: 'Draft' } }], usage: { prompt_tokens: 12, completion_tokens: 4 } });
});
afterEach(() => vi.unstubAllEnvs());
describe('plain drafting provider calls', () => {
  it.each(['openai', 'openrouter'] as const)('uses %s credentials and SDK timeout defaults independently of search', async (provider) => {
    await expect(completeWorkspaceText(runtime(provider), messages)).resolves.toEqual({ text: 'Draft', promptTokens: 12, completionTokens: 4 });
    const client = provider === 'openai' ? mocks.openai : mocks.router;
    expect(client).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'site-secret' }));
    expect(client.mock.calls[0]?.[0]).not.toHaveProperty('timeout');
    expect(client.mock.calls[0]?.[0]).not.toHaveProperty('timeoutMs');
    expect(provider === 'openai' ? mocks.router : mocks.openai).not.toHaveBeenCalled();
    if (provider === 'openai') expect(mocks.create).toHaveBeenCalledWith({ model: 'site-model', messages });
    else expect(mocks.send).toHaveBeenCalledWith({ chatRequest: expect.objectContaining({ model: 'site-model', messages, stream: false }) });
  });
  it('rejects an unexpected OpenRouter streaming completion', async () => {
    mocks.send.mockResolvedValue({});
    await expect(completeWorkspaceText(runtime('openrouter'), messages)).rejects.toThrow('unexpected streaming completion');
  });
});
