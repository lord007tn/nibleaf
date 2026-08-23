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

export interface OpenAICompatibleEmbeddingOptions {
  apiKey: string;
  baseUrl?: string;
  dimensions?: number;
  fetch?: typeof fetch;
  maxBatchSize?: number;
  model?: string;
  timeoutMs?: number;
}

const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
};

const trimLeadingSlashes = (value: string): string => {
  let start = 0;
  while (start < value.length && value.charCodeAt(start) === 47) start += 1;
  return value.slice(start);
};

const endpoint = (baseUrl: string, path: string): string => `${trimTrailingSlashes(baseUrl)}/${trimLeadingSlashes(path)}`;

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxBatchSize: number;
  private readonly requestFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenAICompatibleEmbeddingOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this.model = options.model ?? 'text-embedding-3-small';
    this.dimensions = options.dimensions ?? 1536;
    this.maxBatchSize = options.maxBatchSize ?? 96;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.requestFetch = options.fetch ?? fetch;
  }

  async embed(inputs: string[], signal?: AbortSignal): Promise<EmbeddingBatch> {
    if (inputs.length === 0) return { vectors: [], model: this.model };
    if (inputs.length > this.maxBatchSize) throw new RangeError(`Embedding batch exceeds ${this.maxBatchSize} inputs.`);
    if (inputs.some((input) => input.trim().length === 0)) throw new TypeError('Embedding inputs cannot be empty.');
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const response = await this.requestFetch(endpoint(this.baseUrl, 'embeddings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: inputs, dimensions: this.dimensions, encoding_format: 'float' }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error(`Embedding provider request failed (${response.status}).`);
    const body = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
      model?: string;
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };
    const ordered = [...(body.data ?? [])].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
    const vectors = ordered.map((item) => item.embedding ?? []);
    if (vectors.length !== inputs.length || vectors.some((vector) => vector.length !== this.dimensions)) {
      throw new Error('Embedding provider returned an unexpected vector count or dimension.');
    }
    return {
      vectors,
      model: body.model ?? this.model,
      usage: body.usage ? { promptTokens: body.usage.prompt_tokens, totalTokens: body.usage.total_tokens } : undefined,
    };
  }
}

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface ChatCompletion {
  text: string;
  model: string;
  usage?: ChatUsage;
  latencyMs: number;
}

export interface ChatProvider {
  readonly model: string;
  complete(messages: Array<{ role: 'system' | 'user'; content: string }>, signal?: AbortSignal): Promise<ChatCompletion>;
}

export interface OpenAICompatibleChatOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  model: string;
  siteUrl?: string;
  temperature?: number;
  timeoutMs?: number;
  title?: string;
}

export class OpenAICompatibleChatProvider implements ChatProvider {
  readonly model: string;
  private readonly options: OpenAICompatibleChatOptions;

  constructor(options: OpenAICompatibleChatOptions) {
    this.options = options;
    this.model = options.model;
  }

  async complete(messages: Array<{ role: 'system' | 'user'; content: string }>, signal?: AbortSignal): Promise<ChatCompletion> {
    const started = performance.now();
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30_000);
    const response = await (this.options.fetch ?? fetch)(endpoint(this.options.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
        ...(this.options.siteUrl ? { 'HTTP-Referer': this.options.siteUrl } : {}),
        ...(this.options.title ? { 'X-Title': this.options.title } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.options.temperature ?? 0,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
        usage: { include: true },
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error(`Answer provider request failed (${response.status}).`);
    const body = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
    };
    const usage = body.usage
      ? {
          inputTokens: body.usage.prompt_tokens,
          outputTokens: body.usage.completion_tokens,
          totalTokens: body.usage.total_tokens,
          costUsd: body.usage.cost,
        }
      : undefined;
    return {
      text: body.choices?.[0]?.message?.content ?? '',
      model: body.model ?? this.model,
      latencyMs: performance.now() - started,
      usage,
    };
  }
}
