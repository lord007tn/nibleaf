import type { ClientOptions } from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adapter: { name: 'openrouter' },
  chat: vi.fn(async (_input: unknown) => ({ status: 'no_answer', answer: 'No evidence.', confidence: 0, citations: [] })),
  createOpenRouterText: vi.fn((_model: string, _apiKey: string, _config: unknown) => ({ name: 'openrouter' })),
}));

vi.mock('@tanstack/ai', () => ({ chat: mocks.chat }));
vi.mock('@tanstack/ai-openrouter', () => ({ createOpenRouterText: mocks.createOpenRouterText }));

import { OpenAIEmbeddingProvider, TanStackOpenRouterChatProvider } from './providers';

describe('OpenAI SDK embeddings', () => {
  it('pins the configured model/dimensions and restores provider order', async () => {
    const request = vi.fn<NonNullable<ClientOptions['fetch']>>(
      async (_input, _init) =>
        new Response(
          JSON.stringify({
            object: 'list',
            model: 'embed-model',
            usage: { prompt_tokens: 4, total_tokens: 4 },
            data: [
              { object: 'embedding', index: 1, embedding: [2, 2] },
              { object: 'embedding', index: 0, embedding: [1, 1] },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'secret',
      baseUrl: 'https://provider.test/v1',
      model: 'embed-model',
      dimensions: 2,
      fetch: request,
    });
    await expect(provider.embed(['first', 'second'])).resolves.toMatchObject({
      vectors: [
        [1, 1],
        [2, 2],
      ],
      model: 'embed-model',
      usage: { promptTokens: 4, totalTokens: 4 },
    });
    const call = request.mock.calls[0];
    if (!call) throw new Error('Expected the OpenAI SDK to call fetch.');
    const [url, init] = call;
    expect(String(url)).toBe('https://provider.test/v1/embeddings');
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'embed-model', dimensions: 2, encoding_format: 'float' });
    expect(String(init?.body)).not.toContain('secret');
  });

  it('rejects empty inputs and malformed vector dimensions', async () => {
    const request = vi.fn<NonNullable<ClientOptions['fetch']>>(
      async (_input, _init) =>
        new Response(
          JSON.stringify({
            object: 'list',
            model: 'embed-model',
            usage: { prompt_tokens: 1, total_tokens: 1 },
            data: [{ object: 'embedding', index: 0, embedding: [1] }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const provider = new OpenAIEmbeddingProvider({ apiKey: 'secret', dimensions: 2, fetch: request });
    await expect(provider.embed([''])).rejects.toThrow('cannot be empty');
    await expect(provider.embed(['valid'])).rejects.toThrow('unexpected vector');
  });
});

describe('TanStack AI OpenRouter answers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the official OpenRouter adapter with structured output and no client-side wire implementation', async () => {
    const provider = new TanStackOpenRouterChatProvider({
      apiKey: 'secret',
      baseUrl: 'https://openrouter.test/api/v1',
      model: 'openai/gpt-5.6-luna',
      siteUrl: 'https://nibleaf.com',
      title: 'Nibleaf test',
    });
    const completion = await provider.complete([
      { role: 'system', content: 'Use only sources.' },
      { role: 'user', content: 'Question and sources' },
    ]);

    expect(completion.value).toMatchObject({ status: 'no_answer' });
    expect(mocks.createOpenRouterText).toHaveBeenCalledWith('openai/gpt-5.6-luna', 'secret', {
      serverURL: 'https://openrouter.test/api/v1',
      httpReferer: 'https://nibleaf.com',
      appTitle: 'Nibleaf test',
    });
    expect(mocks.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter: { name: 'openrouter' },
        systemPrompts: ['Use only sources.'],
        messages: [{ role: 'user', content: 'Question and sources' }],
        outputSchema: expect.any(Object),
      }),
    );
  });

  it('rejects model identifiers absent from the pinned adapter catalog before provider I/O', async () => {
    const provider = new TanStackOpenRouterChatProvider({ apiKey: 'secret', model: 'unknown/not-in-catalog' });
    await expect(provider.complete([{ role: 'user', content: 'question' }])).rejects.toThrow();
    expect(mocks.createOpenRouterText).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });
});
