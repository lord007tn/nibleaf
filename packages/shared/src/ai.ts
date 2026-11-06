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
