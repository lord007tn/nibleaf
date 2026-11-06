import { prisma } from '@nibleaf/database';
import { aiConnectionConfigSchema, aiCredentialSchema, type aiProviderIdSchema, aiSelectionSchema } from '@nibleaf/shared/ai';
import { decodeEncryptionKey, decryptSecret } from '@nibleaf/shared/crypto';
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
