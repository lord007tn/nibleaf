import { type Fetcher, HTTPClient, OpenRouter } from '@openrouter/sdk';
import { z } from 'zod';
import { answerOutputSchema, embeddingResponseSchema, nonEmptyProviderTextSchema } from './validators/provider';

export interface OpenRouterEmbeddingOptions {
  apiKey: string;
  dimensions?: number;
  fetch?: Fetcher;
  maxBatchSize?: number;
  model?: string;
  siteUrl?: string;
  timeoutMs?: number;
  title?: string;
}

/** Dense embeddings through OpenRouter's official TypeScript SDK. */
export class OpenRouterEmbeddingProvider {
  readonly dimensions: number;
  readonly model: string;
  private readonly client: OpenRouter;
  private readonly maxBatchSize: number;

  constructor(options: OpenRouterEmbeddingOptions) {
    this.model = options.model ?? 'openai/text-embedding-3-small';
    this.dimensions = options.dimensions ?? 1536;
    this.maxBatchSize = options.maxBatchSize ?? 96;
    this.client = new OpenRouter({
      apiKey: options.apiKey,
      httpReferer: options.siteUrl,
      appTitle: options.title,
      timeoutMs: options.timeoutMs ?? 20_000,
      ...(options.fetch ? { httpClient: new HTTPClient({ fetcher: options.fetch }) } : {}),
    });
  }

  async embed(inputs: string[], signal?: AbortSignal) {
    if (inputs.length === 0) return { vectors: [], model: this.model };
    if (inputs.length > this.maxBatchSize) throw new RangeError(`Embedding batch exceeds ${this.maxBatchSize} inputs.`);
    if (inputs.some((input) => input.trim().length === 0)) throw new TypeError('Embedding inputs cannot be empty.');
    const response = embeddingResponseSchema.parse(
      await this.client.embeddings.generate(
        {
          requestBody: {
            model: this.model,
            input: inputs,
            dimensions: this.dimensions,
            encodingFormat: 'float',
          },
        },
        { signal },
      ),
    );
    const vectors = [...response.data].sort((left, right) => (left.index ?? 0) - (right.index ?? 0)).map((item) => item.embedding);
    if (vectors.length !== inputs.length || vectors.some((vector) => vector.length !== this.dimensions)) {
      throw new Error('Embedding provider returned an unexpected vector count or dimension.');
    }
    return {
      vectors,
      model: response.model || this.model,
      ...(response.usage ? { usage: response.usage } : {}),
    };
  }
}

interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface OpenRouterChatOptions {
  apiKey: string;
  fetch?: Fetcher;
  model: string;
  siteUrl?: string;
  temperature?: number;
  timeoutMs?: number;
  title?: string;
}

/** Grounded answer generation through OpenRouter's official TypeScript SDK. */
export class OpenRouterChatProvider {
  readonly model: string;
  private readonly client: OpenRouter;
  private readonly options: OpenRouterChatOptions;

  constructor(options: OpenRouterChatOptions) {
    this.options = options;
    this.model = options.model;
    this.client = new OpenRouter({
      apiKey: options.apiKey,
      httpReferer: options.siteUrl,
      appTitle: options.title,
      timeoutMs: options.timeoutMs ?? 30_000,
      ...(options.fetch ? { httpClient: new HTTPClient({ fetcher: options.fetch }) } : {}),
    });
  }

  async complete(messages: Array<{ role: 'system' | 'user'; content: string }>, signal?: AbortSignal) {
    const started = performance.now();
    const completion = await this.client.chat.send(
      {
        chatRequest: {
          model: this.model,
          messages,
          temperature: this.options.temperature ?? 0,
          maxCompletionTokens: 1200,
          stream: false,
          responseFormat: {
            type: 'json_schema',
            jsonSchema: {
              name: 'grounded_answer',
              strict: true,
              schema: z.toJSONSchema(answerOutputSchema),
            },
          },
        },
      },
      { signal },
    );
    const value = answerOutputSchema.parse(JSON.parse(nonEmptyProviderTextSchema.parse(completion.choices[0]?.message.content)));
    return {
      value,
      model: completion.model || this.model,
      ...(completion.usage
        ? {
            usage: {
              inputTokens: completion.usage.promptTokens,
              outputTokens: completion.usage.completionTokens,
              totalTokens: completion.usage.totalTokens,
              costUsd: completion.usage.cost ?? undefined,
            },
          }
        : {}),
      latencyMs: performance.now() - started,
    };
  }
}

export type ChatProvider = {
  readonly model: string;
  complete(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    signal?: AbortSignal,
  ): Promise<{ value: unknown; model: string; usage?: ChatUsage; latencyMs: number }>;
};
export type { ChatUsage };
