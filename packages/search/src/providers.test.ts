import type { Fetcher } from '@openrouter/sdk';
import { describe, expect, it, vi } from 'vitest';

import { OpenRouterChatProvider, OpenRouterEmbeddingProvider } from './providers';

describe('OpenRouter SDK embeddings', () => {
  it('pins the configured model/dimensions and restores provider order', async () => {
    const request = vi.fn<Fetcher>(
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
    const provider = new OpenRouterEmbeddingProvider({
      apiKey: 'secret',
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
    if (!call) throw new Error('Expected the OpenRouter SDK to call fetch.');
    const [input, init] = call;
    const sdkRequest = input instanceof Request ? input : new Request(input, init);
    const requestBody = await sdkRequest.text();
    expect(sdkRequest.url).toBe('https://openrouter.ai/api/v1/embeddings');
    expect(JSON.parse(requestBody)).toMatchObject({ model: 'embed-model', dimensions: 2, encoding_format: 'float' });
    expect(requestBody).not.toContain('secret');
  });

  it('rejects empty inputs and malformed vector dimensions', async () => {
    const request = vi.fn<Fetcher>(
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
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'secret', dimensions: 2, fetch: request });
    await expect(provider.embed([''])).rejects.toThrow('cannot be empty');
    await expect(provider.embed(['valid'])).rejects.toThrow('unexpected vector');
  });
});

describe('OpenRouter SDK answers', () => {
  it('requests strict structured output and reports provider usage', async () => {
    const request = vi.fn<Fetcher>(async () =>
      Response.json({
        id: 'generation-1',
        created: 1,
        model: 'openai/gpt-5.6-luna',
        object: 'chat.completion',
        system_fingerprint: null,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({ status: 'no_answer', answer: 'No evidence.', confidence: 0, citations: [] }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.001 },
      }),
    );
    const provider = new OpenRouterChatProvider({
      apiKey: 'secret',
      fetch: request,
      model: 'openai/gpt-5.6-luna',
      siteUrl: 'https://nibleaf.com',
      title: 'Nibleaf test',
    });
    const completion = await provider.complete([
      { role: 'system', content: 'Use only sources.' },
      { role: 'user', content: 'Question and sources' },
    ]);

    expect(completion.value).toMatchObject({ status: 'no_answer' });
    expect(completion.usage).toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14, costUsd: 0.001 });
    const call = request.mock.calls[0];
    if (!call) throw new Error('Expected the OpenRouter SDK to call fetch.');
    const [input, init] = call;
    const sdkRequest = input instanceof Request ? input : new Request(input, init);
    expect(sdkRequest.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(await sdkRequest.text())).toMatchObject({
      model: 'openai/gpt-5.6-luna',
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'grounded_answer', strict: true, schema: expect.any(Object) },
      },
    });
  });

  it('rejects malformed structured output', async () => {
    const request = vi.fn<Fetcher>(async () =>
      Response.json({
        id: 'generation-1',
        created: 1,
        model: 'new/provider-model',
        object: 'chat.completion',
        system_fingerprint: null,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"answer":"missing fields"}' } }],
      }),
    );
    const provider = new OpenRouterChatProvider({ apiKey: 'secret', fetch: request, model: 'new/provider-model' });
    await expect(provider.complete([{ role: 'user', content: 'question' }])).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
  });
});
