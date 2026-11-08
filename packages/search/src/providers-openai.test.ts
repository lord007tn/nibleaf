import type { Fetcher } from '@openrouter/sdk';
import { describe, expect, it } from 'vitest';
import { OpenAIChatProvider, OpenAIEmbeddingProvider } from './providers';

describe('direct OpenAI transport', () => {
  it('sends embeddings to OpenAI with its key, dimensions and normalized usage', async () => {
    const calls: Request[] = [];
    const transport: Fetcher = async (input, init) => {
      calls.push(new Request(input, init));
      return Response.json({
        data: [{ index: 0, embedding: [1, 2] }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 3, total_tokens: 3 },
      });
    };
    const provider = new OpenAIEmbeddingProvider({ apiKey: 'openai-test-only', dimensions: 2, fetch: transport });
    await expect(provider.embed(['published documentation'])).resolves.toEqual({
      vectors: [[1, 2]],
      model: 'text-embedding-3-small',
      usage: { promptTokens: 3, totalTokens: 3 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/embeddings');
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer openai-test-only');
    expect(await calls[0]?.json()).toMatchObject({ model: 'text-embedding-3-small', dimensions: 2, encoding_format: 'float' });
  });

  it('validates structured OpenAI answers without routing through OpenRouter', async () => {
    const calls: Request[] = [];
    const value = { status: 'answered', answer: 'Published source answer', confidence: 0.9, citations: ['source-1'] };
    const transport: Fetcher = async (input, init) => {
      calls.push(new Request(input, init));
      return Response.json({
        id: 'completion-test',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-test',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    };
    const provider = new OpenAIChatProvider({ apiKey: 'openai-test-only', model: 'gpt-test', fetch: transport });
    await expect(provider.complete([{ role: 'user', content: 'Question' }])).resolves.toMatchObject({
      value,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    const body = await calls[0]?.json();
    expect(body).toMatchObject({ response_format: { type: 'json_schema', json_schema: { strict: true } }, model: 'gpt-test' });
    expect(body).not.toHaveProperty('temperature');
    // An unversioned (pinned, non-reasoning) model must not get reasoning_effort, which OpenAI rejects there.
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('does not attach credential-bearing SDK failures to outward errors', async () => {
    const transport: Fetcher = async () => {
      throw new Error('Bearer openai-test-only private provider details');
    };
    const provider = new OpenAIEmbeddingProvider({ apiKey: 'openai-test-only', dimensions: 2, fetch: transport });
    const error = await provider.embed(['source']).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('openai-test-only');
    expect(error).not.toHaveProperty('cause');
  });
});
