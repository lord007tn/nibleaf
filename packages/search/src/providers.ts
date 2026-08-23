import { chat } from '@tanstack/ai';
import { createOpenRouterText } from '@tanstack/ai-openrouter';
import { OPENROUTER_CHAT_MODELS } from '@tanstack/ai-openrouter/model-meta';
import OpenAI, { type ClientOptions } from 'openai';
import { z } from 'zod';

export interface EmbeddingUsage {
  promptTokens?: number;
  totalTokens?: number;
}

export interface EmbeddingBatch {
  vectors: number[][];
  model: string;
  usage?: EmbeddingUsage;
}

export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly model: string;
  embed(inputs: string[], signal?: AbortSignal): Promise<EmbeddingBatch>;
}

export interface OpenAIEmbeddingOptions {
  apiKey: string;
  baseUrl?: string;
  dimensions?: number;
  fetch?: NonNullable<ClientOptions['fetch']>;
  maxBatchSize?: number;
  model?: string;
  timeoutMs?: number;
}

/** OpenAI-compatible embeddings through the official OpenAI SDK. A custom
 * base URL keeps self-hosted and compatible providers configurable without
 * maintaining a second wire client. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly model: string;
  private readonly client: OpenAI;
  private readonly maxBatchSize: number;

  constructor(options: OpenAIEmbeddingOptions) {
    this.model = options.model ?? 'text-embedding-3-small';
    this.dimensions = options.dimensions ?? 1536;
    this.maxBatchSize = options.maxBatchSize ?? 96;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl ?? 'https://api.openai.com/v1',
      timeout: options.timeoutMs ?? 20_000,
      maxRetries: 0,
      fetch: options.fetch,
    });
  }

  async embed(inputs: string[], signal?: AbortSignal): Promise<EmbeddingBatch> {
    if (inputs.length === 0) return { vectors: [], model: this.model };
    if (inputs.length > this.maxBatchSize) throw new RangeError(`Embedding batch exceeds ${this.maxBatchSize} inputs.`);
    if (inputs.some((input) => input.trim().length === 0)) throw new TypeError('Embedding inputs cannot be empty.');
    const response = await this.client.embeddings.create(
      {
        model: this.model,
        input: inputs,
        dimensions: this.dimensions,
        encoding_format: 'float',
      },
      { signal },
    );
    const vectors = [...response.data].sort((left, right) => left.index - right.index).map((item) => item.embedding);
    if (vectors.length !== inputs.length || vectors.some((vector) => vector.length !== this.dimensions)) {
      throw new Error('Embedding provider returned an unexpected vector count or dimension.');
    }
    return {
      vectors,
      model: response.model || this.model,
      usage: { promptTokens: response.usage.prompt_tokens, totalTokens: response.usage.total_tokens },
    };
  }
}

export const answerOutputSchema = z
  .object({
    status: z.enum(['answered', 'no_answer']),
    answer: z.string(),
    confidence: z.number().min(0).max(1),
    citations: z.array(z.string()),
  })
  .strict();

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface ChatCompletion {
  value: unknown;
  model: string;
  usage?: ChatUsage;
  latencyMs: number;
}

export interface ChatProvider {
  readonly model: string;
  complete(messages: Array<{ role: 'system' | 'user'; content: string }>, signal?: AbortSignal): Promise<ChatCompletion>;
}

export interface TanStackOpenRouterOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  siteUrl?: string;
  temperature?: number;
  timeoutMs?: number;
  title?: string;
}

/** Grounded answer generation through TanStack AI's OpenRouter adapter. The
 * adapter itself uses OpenRouter's official SDK and native structured output. */
export class TanStackOpenRouterChatProvider implements ChatProvider {
  readonly model: string;
  private readonly options: TanStackOpenRouterOptions;

  constructor(options: TanStackOpenRouterOptions) {
    this.options = options;
    this.model = options.model;
  }

  async complete(messages: Array<{ role: 'system' | 'user'; content: string }>, signal?: AbortSignal): Promise<ChatCompletion> {
    const started = performance.now();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error('OpenRouter answer generation timed out.')), this.options.timeoutMs ?? 30_000);
    let usage: ChatUsage | undefined;
    try {
      const value = await chat({
        adapter: createOpenRouterText(z.enum(OPENROUTER_CHAT_MODELS).parse(this.model), this.options.apiKey, {
          serverURL: this.options.baseUrl ?? 'https://openrouter.ai/api/v1',
          httpReferer: this.options.siteUrl,
          appTitle: this.options.title,
        }),
        systemPrompts: messages.filter((message) => message.role === 'system').map((message) => message.content),
        messages: messages.flatMap((message) => (message.role === 'user' ? [{ role: 'user' as const, content: message.content }] : [])),
        outputSchema: answerOutputSchema,
        abortController: controller,
        modelOptions: {
          temperature: this.options.temperature ?? 0,
          maxCompletionTokens: 1200,
        },
        middleware: [
          {
            name: 'nibleaf-answer-usage',
            onFinish: (_context, info) => {
              if (!info.usage) return;
              usage = {
                inputTokens: info.usage.promptTokens,
                outputTokens: info.usage.completionTokens,
                totalTokens: info.usage.totalTokens,
                costUsd: info.usage.cost,
              };
            },
          },
        ],
      });
      return { value, model: this.model, usage, latencyMs: performance.now() - started };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
}
