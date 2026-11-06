import { prisma } from '@nibleaf/database';
import { aiConnectionConfigSchema, aiCredentialSchema, type aiProviderIdSchema, aiSelectionSchema } from '@nibleaf/shared/ai';
import { decodeEncryptionKey, decryptSecret } from '@nibleaf/shared/crypto';
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible';
import { z } from 'zod';
import { keys } from './keys';
import { OpenAIChatProvider, OpenAIEmbeddingProvider, OpenRouterChatProvider, OpenRouterEmbeddingProvider } from './providers';

const configurationSchema = z.object({
  search: z.object({ aiProvider: aiSelectionSchema.optional(), aiAnswers: z.boolean().optional() }).optional(),
});

/** Resolve live project state for every operation. An explicit workspace selection
 * never falls back to another tenant's or the instance's paid credentials. */
export const resolveWorkspaceAi = async (projectId: string) => {
  const env = keys();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { config: true } });
  if (!project) return null;
  const configuration = configurationSchema.safeParse(project.config ?? {});
  if (!configuration.success) return null;
  const selection = configuration.data.search?.aiProvider ?? 'instance';
  // Read the live switch here so a replica with cached site config cannot keep
  // spending the workspace key after answers are turned off.
  const answersSwitchedOn = configuration.data.search?.aiAnswers === true;
  if (selection === 'disabled') return null;
  if (selection === 'instance') {
    return env.OPENROUTER_API_KEY
      ? {
          providerId: 'openrouter' as const,
          apiKey: env.OPENROUTER_API_KEY,
          answerModel: env.SEARCH_ANSWER_MODEL,
          embeddingModel: env.SEARCH_EMBEDDING_MODEL,
          revision: 'instance',
          answersEnabled: env.SEARCH_ANSWER_ENABLED && answersSwitchedOn,
        }
      : null;
  }
  const connection = await prisma.projectIntegration.findUnique({ where: { projectId_providerId: { projectId, providerId: selection } } });
  if (connection?.status !== 'ACTIVE' || connection.lastVerificationStatus !== 'HEALTHY') return null;
  const config = aiConnectionConfigSchema.safeParse(connection.config);
  if (!config.success || config.data.embeddingModel !== env.SEARCH_EMBEDDING_MODEL) return null;
  try {
    if (!env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY) return null;
    const keyring = [env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY, ...env.INTEGRATION_CREDENTIAL_PREVIOUS_KEYS].map(decodeEncryptionKey);
    const credential = aiCredentialSchema.parse(JSON.parse(decryptSecret(connection.credentialEncrypted, keyring)));
    if (credential.projectId !== projectId || credential.providerId !== selection) return null;
    if (selection === 'openai' && !config.data.embeddingModel.startsWith('openai/')) return null;
    return {
      providerId: selection,
      apiKey: credential.apiKey,
      ...config.data,
      revision: `${connection.id}:${connection.revision}`,
      answersEnabled: answersSwitchedOn,
    };
  } catch {
    return null;
  }
};

export interface WorkspaceAiRuntime {
  providerId: z.infer<typeof aiProviderIdSchema>;
  apiKey: string;
  answerModel: string;
  embeddingModel: string;
  revision: string;
  answersEnabled: boolean;
}

export const workspaceEmbeddingProvider = (runtime: WorkspaceAiRuntime) => {
  const env = keys();
  const options = {
    apiKey: runtime.apiKey,
    model: runtime.embeddingModel,
    dimensions: env.SEARCH_EMBEDDING_DIMENSIONS,
    timeoutMs: env.SEARCH_EMBEDDING_TIMEOUT_MS,
  };
  return runtime.providerId === 'openai'
    ? new OpenAIEmbeddingProvider({ ...options, model: options.model.replace(/^openai\//, '') })
    : new OpenRouterEmbeddingProvider(options);
};

export const workspaceAnswerProvider = (runtime: WorkspaceAiRuntime) => {
  const options = { apiKey: runtime.apiKey, model: runtime.answerModel, timeoutMs: keys().SEARCH_ANSWER_TIMEOUT_MS, temperature: 0 };
  return runtime.providerId === 'openai' ? new OpenAIChatProvider(options) : new OpenRouterChatProvider(options);
};

/** Direct OpenAI uses precisely the model id used by OpenAIChatProvider. */
export const workspaceChatAdapter = (runtime: WorkspaceAiRuntime, cost?: ChatCostSink) =>
  openaiCompatibleText(runtime.answerModel, {
    baseURL: runtime.providerId === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1',
    apiKey: runtime.apiKey,
    api: 'chat-completions',
    timeout: keys().SEARCH_ANSWER_TIMEOUT_MS,
    maxRetries: 0,
    ...(runtime.providerId === 'openrouter' && cost ? { fetch: costReportingFetch(cost) } : {}),
  });

/** Accumulates provider-reported spend across the calls of one chat turn. */
export interface ChatCostSink {
  costUsd?: number;
  /** Billed responses (successful), and how many of them reported a cost. */
  calls?: number;
  costed?: number;
  /** Response scans still reading; await before recording the turn. */
  pending?: Promise<void>[];
}

/** A sink's spend, known only when every billed response reported its cost: a
 * call whose cost could not be read (stopped, cut off) leaves it unknown rather
 * than undercounted. Undefined when no response was billed through it. */
export const knownChatCost = (sink: ChatCostSink): number | undefined => (sink.calls && sink.costed === sink.calls ? (sink.costUsd ?? 0) : undefined);

const COST = /"cost"\s*:\s*(\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;

/** OpenRouter reports each call's cost in `usage.cost`, which the OpenAI-
 * compatible adapter does not surface. Read it from a tee of the response
 * (streamed or not) without delaying the reader's stream. */
export const costReportingFetch =
  (sink: ChatCostSink, base: typeof fetch = fetch): typeof fetch =>
  async (input, init) => {
    const response = await base(input, init);
    if (!response.ok || !response.body) return response;
    sink.calls = (sink.calls ?? 0) + 1;
    const [forward, scan] = response.body.tee();
    const scanning = (async () => {
      const decoder = new TextDecoder();
      let text = '';
      const reader = scan.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        // Usage arrives last; keep only a bounded tail of the body.
        if (text.length > 16_384) text = text.slice(-8192);
      }
      const usage = text.slice(text.lastIndexOf('"usage"'));
      const match = [...usage.matchAll(COST)][0];
      if (!match?.[1]) return;
      sink.costUsd = (sink.costUsd ?? 0) + Number(match[1]);
      sink.costed = (sink.costed ?? 0) + 1;
    })().catch(() => undefined);
    sink.pending = [...(sink.pending ?? []), scanning];
    return new Response(forward, { status: response.status, statusText: response.statusText, headers: response.headers });
  };

/** Direct OpenAI mirrors OpenAIChatProvider (no temperature, completion-token cap);
 * OpenRouter mirrors OpenRouterChatProvider (deterministic temperature). */
export const workspaceChatModelOptions =
  (runtime: Pick<WorkspaceAiRuntime, 'providerId'>) =>
  (maxTokens: number): Record<string, unknown> =>
    runtime.providerId === 'openai' ? { max_completion_tokens: maxTokens } : { temperature: 0, max_tokens: maxTokens };
