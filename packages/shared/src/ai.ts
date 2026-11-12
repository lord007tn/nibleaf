import { z } from 'zod';

export const AI_PROVIDER_IDS = ['openai', 'openrouter'] as const;
export const aiProviderIdSchema = z.enum(AI_PROVIDER_IDS);
export const aiSelectionSchema = z.enum(['instance', ...AI_PROVIDER_IDS, 'disabled']);
export const aiConnectionConfigSchema = z
  .object({ answerModel: z.string().trim().min(1).max(180), embeddingModel: z.string().trim().min(1).max(180) })
  .strict();

/** Authenticated inside the encryption envelope, preventing cross-workspace or
 * cross-provider credential substitution even if a ciphertext is copied. */
export const aiCredentialSchema = z
  .object({ kind: z.literal('workspace-ai'), projectId: z.string(), providerId: aiProviderIdSchema, apiKey: z.string().min(1) })
  .strict();

/**
 * Names people read for the models Nibleaf commonly runs. Site owners see a
 * model by name ("GPT-6 Luna"); the provider id stays available for details.
 * Keys are bare ids: a provider prefix ("openai/") is ignored when looking up.
 */
const AI_MODEL_LABELS: Readonly<Record<string, string>> = {
  'gpt-6-luna': 'GPT-6 Luna',
  'gpt-6-terra': 'GPT-6 Terra',
  'gpt-6-sol': 'GPT-6 Sol',
  'gpt-6': 'GPT-6',
  'text-embedding-3-large': 'OpenAI text embeddings (large)',
  'text-embedding-3-small': 'OpenAI text embeddings (small)',
};

/**
 * A model's readable name: a known label, else the id without its provider
 * prefix (which is still more readable than "provider/model"). Never empty.
 */
export const aiModelLabel = (id: string): string => {
  const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  // Own keys only: an id like "constructor" must not read a label off the prototype.
  return (Object.hasOwn(AI_MODEL_LABELS, bare) ? AI_MODEL_LABELS[bare] : undefined) ?? (bare || id);
};
