import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleChatProvider, OpenAICompatibleEmbeddingProvider } from './providers';

describe('OpenAI-compatible embeddings', () => {
  it('pins the configured model/dimensions and restores provider order', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'embed-model',
          data: [
            { index: 1, embedding: [2, 2] },
            { index: 0, embedding: [1, 1] },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new OpenAICompatibleEmbeddingProvider({
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
    });
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe('https://provider.test/v1/embeddings');
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'embed-model', dimensions: 2, encoding_format: 'float' });
    expect(String(init?.body)).not.toContain('secret');
  });

  it('rejects empty inputs and malformed vector dimensions', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }), { status: 200 }));
    const provider = new OpenAICompatibleEmbeddingProvider({ apiKey: 'secret', dimensions: 2, fetch: request });
    await expect(provider.embed([''])).rejects.toThrow('cannot be empty');
    await expect(provider.embed(['valid'])).rejects.toThrow('unexpected vector');
  });
});

describe('OpenAI-compatible chat', () => {
  it('keeps omitted provider usage unknown instead of fabricating zero tokens or cost', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ model: 'answer-model', choices: [{ message: { content: '{"status":"no_answer"}' } }] }), { status: 200 }),
      );
    const provider = new OpenAICompatibleChatProvider({
      apiKey: 'secret',
      baseUrl: 'https://provider.test/v1',
      model: 'answer-model',
      fetch: request,
    });
    const completion = await provider.complete([{ role: 'user', content: 'question' }]);
    expect(completion.usage).toBeUndefined();
    expect(JSON.stringify(request.mock.calls[0]?.[1]?.body)).not.toContain('secret');
  });
});
