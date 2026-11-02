import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  env: {
    AI_DRAFT_MODEL: 'openai/gpt-4o-mini',
    APP_NAME: 'Nibleaf test',
    APP_URL: 'https://nibleaf.test',
    OPENROUTER_API_KEY: 'secret' as string | undefined,
  },
  extras: { AI_DAILY_LIMIT: 50 },
}));

vi.mock('@openrouter/sdk', () => ({
  OpenRouter: class {
    chat = { send: mocks.send };
  },
}));

vi.mock('@/env', () => ({ env: mocks.env }));
vi.mock('@/lib/env-extras', () => ({ envExtras: mocks.extras }));

import { aiDraftAvailable, draftContentWithTelemetry } from './ai';

describe('AI drafting through OpenRouter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the configured OpenRouter model and reports SDK usage', async () => {
    mocks.send.mockResolvedValue({
      choices: [{ message: { content: '  Improved documentation.  ' } }],
      usage: { promptTokens: 12, completionTokens: 4 },
    });

    await expect(draftContentWithTelemetry({ mode: 'rephrase', content: 'Draft' })).resolves.toMatchObject({
      text: 'Improved documentation.',
      promptTokens: 12,
      completionTokens: 4,
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
    expect(mocks.send).toHaveBeenCalledWith({
      chatRequest: expect.objectContaining({
        model: 'openai/gpt-4o-mini',
        stream: false,
        messages: [expect.objectContaining({ role: 'system' }), expect.objectContaining({ role: 'user', content: expect.stringContaining('Draft') })],
      }),
    });
  });

  it('propagates provider errors', async () => {
    mocks.send.mockRejectedValue(new Error('provider unavailable'));

    await expect(draftContentWithTelemetry({ mode: 'outline', content: 'API guide' })).rejects.toThrow('provider unavailable');
  });

  it('rejects an unexpected streaming completion', async () => {
    mocks.send.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [] };
      },
    });

    await expect(draftContentWithTelemetry({ mode: 'outline', content: 'API guide' })).rejects.toThrow('unexpected streaming completion');
  });
});

describe('AI draft availability', () => {
  beforeEach(() => {
    mocks.env.OPENROUTER_API_KEY = 'secret';
    mocks.extras.AI_DAILY_LIMIT = 50;
  });

  it('requires a provider key and a positive daily limit', () => {
    expect(aiDraftAvailable()).toBe(true);
    mocks.extras.AI_DAILY_LIMIT = 0;
    expect(aiDraftAvailable()).toBe(false);
    mocks.extras.AI_DAILY_LIMIT = 50;
    mocks.env.OPENROUTER_API_KEY = undefined;
    expect(aiDraftAvailable()).toBe(false);
  });
});
