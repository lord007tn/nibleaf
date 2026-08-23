import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock('@openrouter/sdk', () => ({
  OpenRouter: class {
    chat = { send: mocks.send };
  },
}));

vi.mock('@/env', () => ({
  env: {
    AI_DRAFT_MODEL: 'openai/gpt-4o-mini',
    APP_NAME: 'Nibleaf test',
    APP_URL: 'https://nibleaf.test',
    OPENROUTER_API_KEY: 'secret',
  },
}));

import { draftContentWithTelemetry } from './ai';

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
      outcome: 'completed',
    });
    expect(mocks.send).toHaveBeenCalledWith({
      chatRequest: expect.objectContaining({
        model: 'openai/gpt-4o-mini',
        stream: false,
        messages: [expect.objectContaining({ role: 'system' }), expect.objectContaining({ role: 'user', content: expect.stringContaining('Draft') })],
      }),
    });
  });

  it('falls back without leaking provider errors', async () => {
    mocks.send.mockRejectedValue(new Error('provider unavailable'));

    await expect(draftContentWithTelemetry({ mode: 'outline', content: 'API guide' })).resolves.toMatchObject({
      provider: 'nibleaf_offline',
      model: 'deterministic-fallback',
      outcome: 'fallback',
    });
  });
});
