import type { Fetcher } from '@openrouter/sdk';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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

  it.each([
    [0, 0],
    [0, 2],
    [1, 2],
  ])('rejects corrupt embedding indexes %j before vectors reach the index', async (...indexes) => {
    const request = vi.fn<Fetcher>(async () =>
      Response.json({ object: 'list', model: 'test', data: indexes.map((index) => ({ object: 'embedding', index, embedding: [1, 2] })) }),
    );
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'test', dimensions: 2, fetch: request });
    await expect(provider.embed(['first', 'second'])).rejects.toThrow('unexpected vector');
  });

  it('bounds Arabic batches by bytes and count, preserves order, and sums actual usage', async () => {
    const batches: string[][] = [];
    const request = vi.fn<Fetcher>(async (input, init) => {
      const body = z.object({ input: z.array(z.string()) }).parse(await (input instanceof Request ? input : new Request(input, init)).json());
      batches.push(body.input);
      return Response.json({
        object: 'list',
        model: 'test',
        usage: { prompt_tokens: body.input.length, total_tokens: body.input.length },
        data: body.input.map((text: string, index: number) => ({ object: 'embedding', index, embedding: [text.length, index] })),
      });
    });
    const provider = new OpenRouterEmbeddingProvider({
      apiKey: 'test',
      dimensions: 2,
      fetch: request,
      maxBatchSize: 2,
      maxInputBytes: 8,
      maxBatchBytes: 8,
    });
    const result = await provider.embed(['حجز', 'غرف', 'a', 'bb', 'ccc']);
    expect(batches).toEqual([['حجز'], ['غرف', 'a'], ['bb', 'ccc']]);
    expect(result.vectors.map((vector) => vector[0])).toEqual([3, 3, 1, 2, 3]);
    expect(result.usage).toEqual({ promptTokens: 5, totalTokens: 5 });
  });

  it('preflights the entire input and honors cancellation between batches', async () => {
    const controller = new AbortController();
    const request = vi.fn<Fetcher>(async () => {
      controller.abort();
      return Response.json({ object: 'list', model: 'test', data: [{ object: 'embedding', index: 0, embedding: [1, 2] }] });
    });
    const provider = new OpenRouterEmbeddingProvider({
      apiKey: 'test',
      dimensions: 2,
      fetch: request,
      maxBatchSize: 1,
      maxInputBytes: 8,
      maxBatchBytes: 8,
    });
    await expect(provider.embed(['ok', 'هذا نص طويل'])).rejects.toThrow('UTF-8 bytes');
    expect(request).not.toHaveBeenCalled();
    await expect(provider.embed(['one', 'two'], controller.signal)).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
  });

  it('keeps split-batch usage unknown when any provider batch omits it', async () => {
    let call = 0;
    const request = vi.fn<Fetcher>(async () =>
      Response.json({
        object: 'list',
        model: 'test',
        ...(call++ === 0 ? {} : { usage: { prompt_tokens: 1, total_tokens: 1 } }),
        data: [{ object: 'embedding', index: 0, embedding: [1, 2] }],
      }),
    );
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'test', dimensions: 2, fetch: request, maxBatchSize: 1 });
    expect((await provider.embed(['one', 'two'])).usage).toBeUndefined();
  });
});

describe('OpenRouter SDK answers', () => {
  it('rejects an unexpected event stream from a non-streaming request', async () => {
    const request = vi.fn<Fetcher>(async () => new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const provider = new OpenRouterChatProvider({ apiKey: 'secret', fetch: request, model: 'test/model' });
    await expect(provider.complete([{ role: 'user', content: 'question' }])).rejects.toThrow('unexpected streaming completion');
    expect(request).toHaveBeenCalledOnce();
  });

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
