import { type Fetcher, HTTPClient, OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import { answerOutputSchema, embeddingResponseSchema, nonEmptyProviderTextSchema } from './validators/provider';

export interface OpenRouterEmbeddingOptions {
  apiKey: string;
  dimensions?: number;
  fetch?: Fetcher;
  maxBatchSize?: number;
  /** Conservative UTF-8 byte budgets also bound multilingual token usage. */
  maxInputBytes?: number;
  maxBatchBytes?: number;
  model?: string;
  siteUrl?: string;
  timeoutMs?: number;
  title?: string;
}

abstract class BatchedEmbeddingProvider {
  readonly dimensions: number;
  readonly model: string;
  private readonly maxBatchSize: number;
  private readonly maxInputBytes: number;
  private readonly maxBatchBytes: number;

  constructor(options: OpenRouterEmbeddingOptions) {
    this.model = options.model ?? 'openai/text-embedding-3-small';
    this.dimensions = options.dimensions ?? 1536;
    this.maxBatchSize = options.maxBatchSize ?? 96;
    this.maxInputBytes = options.maxInputBytes ?? 8191;
    this.maxBatchBytes = options.maxBatchBytes ?? 100_000;
    if (
      ![this.maxBatchSize, this.maxInputBytes, this.maxBatchBytes, this.dimensions].every((value) => Number.isSafeInteger(value) && value > 0) ||
      this.maxBatchBytes < this.maxInputBytes
    ) {
      throw new RangeError('Embedding limits must be positive integers and the batch budget must cover one input.');
    }
  }

  async embed(inputs: string[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (inputs.length === 0) return { vectors: [], model: this.model };
    if (inputs.some((input) => input.trim().length === 0)) throw new TypeError('Embedding inputs cannot be empty.');
    // Validate the entire operation before sending any billable request. Count
    // limits alone let long Arabic/mixed documentation overflow provider limits.
    const sizes = inputs.map((input) => Buffer.byteLength(input, 'utf8'));
    if (sizes.some((size) => size > this.maxInputBytes)) throw new RangeError(`Embedding input exceeds ${this.maxInputBytes} UTF-8 bytes.`);
    const vectors: number[][] = [];
    let model = this.model;
    let usage: { promptTokens: number; totalTokens: number } | undefined;
    let offset = 0;
    while (offset < inputs.length) {
      signal?.throwIfAborted();
      let end = offset;
      let bytes = 0;
      while (end < inputs.length && end - offset < this.maxBatchSize && bytes + (sizes[end] ?? 0) <= this.maxBatchBytes) {
        bytes += sizes[end] ?? 0;
        end += 1;
      }
      const batch = inputs.slice(offset, end);
      const result = await this.embedBatch(batch, signal).catch(() => {
        signal?.throwIfAborted();
        throw new Error('Embedding provider returned an unexpected vector response or could not complete the request.');
      });
      vectors.push(...result.vectors);
      model = result.model;
      // Missing provider usage stays unknown; never under-report a split batch.
      usage =
        result.usage && (offset === 0 || usage)
          ? {
              promptTokens: (usage?.promptTokens ?? 0) + result.usage.promptTokens,
              totalTokens: (usage?.totalTokens ?? 0) + result.usage.totalTokens,
            }
          : undefined;
      offset = end;
    }
    return { vectors, model, ...(usage ? { usage } : {}) };
  }

  protected abstract embedBatch(
    inputs: string[],
    signal?: AbortSignal,
  ): Promise<{
    vectors: number[][];
    model: string;
    usage?: { promptTokens: number; totalTokens: number };
  }>;
}

const validatedEmbeddings = (value: unknown, inputs: string[], dimensions: number, model: string) => {
  const response = embeddingResponseSchema.parse(value);
  const ordered = [...response.data].sort((left, right) => left.index - right.index);
  const vectors = ordered.map((item) => item.embedding);
  if (
    ordered.some((item, index) => item.index !== index) ||
    vectors.length !== inputs.length ||
    vectors.some((vector) => vector.length !== dimensions)
  ) {
    throw new Error('Embedding provider returned an unexpected vector count or dimension.');
  }
  return { vectors, model: response.model || model, ...(response.usage ? { usage: response.usage } : {}) };
};

/** Dense embeddings through OpenRouter's official TypeScript SDK. */
export class OpenRouterEmbeddingProvider extends BatchedEmbeddingProvider {
  private readonly client: OpenRouter;

  constructor(options: OpenRouterEmbeddingOptions) {
    super(options);
    this.client = new OpenRouter({
      apiKey: options.apiKey,
      httpReferer: options.siteUrl,
      appTitle: options.title,
      timeoutMs: options.timeoutMs ?? 20_000,
      ...(options.fetch ? { httpClient: new HTTPClient({ fetcher: options.fetch }) } : {}),
    });
  }

  protected async embedBatch(inputs: string[], signal?: AbortSignal) {
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
    return validatedEmbeddings(response, inputs, this.dimensions, this.model);
  }
}

/** Direct OpenAI keys use OpenAI's SDK and endpoint, never the OpenRouter gateway. */
export class OpenAIEmbeddingProvider extends BatchedEmbeddingProvider {
  private readonly client: OpenAI;

  constructor(options: OpenRouterEmbeddingOptions) {
    super({ ...options, model: options.model ?? 'text-embedding-3-small' });
    this.client = new OpenAI({ apiKey: options.apiKey, timeout: options.timeoutMs ?? 20_000, maxRetries: 0, fetch: options.fetch });
  }

  protected async embedBatch(inputs: string[], signal?: AbortSignal) {
    const response = await this.client.embeddings.create(
      { model: this.model, input: inputs, dimensions: this.dimensions, encoding_format: 'float' },
      { signal },
    );
    return validatedEmbeddings(
      { ...response, usage: response.usage ? { promptTokens: response.usage.prompt_tokens, totalTokens: response.usage.total_tokens } : undefined },
      inputs,
      this.dimensions,
      this.model,
    );
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

const parseProviderAnswer = (content: unknown) => {
  try {
    return answerOutputSchema.parse(JSON.parse(nonEmptyProviderTextSchema.parse(content)));
  } catch {
    throw new Error('The answer provider returned an invalid structured response.');
  }
};

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
    const completion = await this.client.chat
      .send(
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
      )
      .catch(() => {
        signal?.throwIfAborted();
        throw new Error('The answer provider could not complete the request.');
      });
    if (!('choices' in completion)) throw new Error('OpenRouter returned an unexpected streaming completion.');
    const value = parseProviderAnswer(completion.choices[0]?.message.content);
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

export class OpenAIChatProvider {
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options: OpenRouterChatOptions) {
    this.model = options.model;
    this.client = new OpenAI({ apiKey: options.apiKey, timeout: options.timeoutMs ?? 30_000, maxRetries: 0, fetch: options.fetch });
  }

  async complete(messages: Array<{ role: 'system' | 'user'; content: string }>, signal?: AbortSignal) {
    const started = performance.now();
    const completion = await this.client.chat.completions
      .create(
        {
          model: this.model,
          messages,
          max_completion_tokens: 1200,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'grounded_answer', strict: true, schema: z.toJSONSchema(answerOutputSchema) },
          },
        },
        { signal },
      )
      .catch(() => {
        signal?.throwIfAborted();
        throw new Error('The answer provider could not complete the request.');
      });
    const value = parseProviderAnswer(completion.choices[0]?.message.content);
    return {
      value,
      model: completion.model || this.model,
      ...(completion.usage
        ? {
            usage: {
              inputTokens: completion.usage.prompt_tokens,
              outputTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
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
