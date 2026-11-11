import { aiProviderIdSchema, aiSelectionSchema } from '@nibleaf/shared/ai';
import { z } from 'zod';

const apiKey = z
  .string()
  .trim()
  .min(10)
  .max(4096)
  .refine((value) => !/[\r\n]/.test(value));

export const workspaceAiModelsBody = z.object({ providerId: aiProviderIdSchema, apiKey: apiKey.optional() }).strict();
export const saveWorkspaceAiConnectionBody = z
  .object({
    providerId: aiProviderIdSchema,
    apiKey: apiKey.optional(),
    answerModel: z.string().trim().min(1).max(180),
    expectedRevision: z.number().int().nonnegative(),
    replaceCredential: z.literal(true).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.expectedRevision === 0 && !value.apiKey)
      ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'An API key is required for a new connection.' });
    if (value.expectedRevision > 0 && value.apiKey && !value.replaceCredential)
      ctx.addIssue({ code: 'custom', path: ['replaceCredential'], message: 'Confirm credential replacement.' });
  });
export const workspaceAiSelectionBody = z
  .object({ providerId: aiSelectionSchema, answersEnabled: z.boolean(), expectedRevision: z.number().int().positive().optional() })
  .strict();

export type WorkspaceAiModelsBody = z.infer<typeof workspaceAiModelsBody>;
export type SaveWorkspaceAiConnectionBody = z.infer<typeof saveWorkspaceAiConnectionBody>;
export type WorkspaceAiSelectionBody = z.infer<typeof workspaceAiSelectionBody>;

export const workspaceAiProviderSchema = z
  .object({
    id: aiProviderIdSchema,
    configured: z.boolean(),
    revision: z.number().int().nonnegative(),
    verified: z.boolean(),
    verifiedAt: z.iso.datetime().nullable(),
    answerModel: z.string().nullable(),
  })
  .strict();
const aiModelRefSchema = z.object({ id: z.string(), label: z.string() }).strict();

/**
 * What this server can offer a site for AI answers, from runtime configuration
 * only (operations/ux/ai-and-integrations.md §4.6). There is no Cloud or
 * self-hosted branch: an option exists exactly when the server can serve it.
 */
export const siteAiCapabilitiesSchema = z
  .object({
    /** "Nibleaf AI": the server's own provider. */
    managed: z
      .object({
        available: z.boolean(),
        reason: z.enum(['noServerKey', 'answersDisabledOnServer']).nullable(),
        model: aiModelRefSchema.nullable(),
        dailyAnswerLimit: z.number().int().nonnegative(),
      })
      .strict(),
    /** A site's own key can be stored at all. */
    ownKey: z.object({ available: z.boolean(), reason: z.enum(['credentialStorageMissing']).nullable() }).strict(),
    providers: z.array(
      z
        .object({
          id: aiProviderIdSchema,
          available: z.boolean(),
          reason: z.enum(['credentialStorageMissing', 'embeddingModelRequiresOpenRouter']).nullable(),
        })
        .strict(),
    ),
    /** Answers need the search index on this server. */
    answers: z.object({ available: z.boolean(), reason: z.enum(['searchNotConfigured']).nullable() }).strict(),
  })
  .strict();

/** Where a site's AI answers stand right now. Never carries a key. */
export const siteAiStatusSchema = z
  .object({
    /** The site's saved switch. */
    answersOn: z.boolean(),
    /** The selected source; null once AI is turned off for the site. */
    source: z.enum(['managed', 'openai', 'openrouter']).nullable(),
    /** The selected source can answer readers (key present, accepted, usable). */
    sourceReady: z.boolean(),
    connections: z.array(
      z
        .object({
          id: aiProviderIdSchema,
          state: z.enum(['ok', 'rejected', 'needsRecheck', 'unreadable']),
          keyHint: z.string().max(4).nullable(),
          addedAt: z.iso.datetime(),
          model: aiModelRefSchema.nullable(),
        })
        .strict(),
    ),
    published: z.object({ version: z.number().int(), at: z.iso.datetime().nullable() }).strict().nullable(),
    preparation: z
      .object({
        state: z.enum(['none', 'running', 'ready', 'failed']),
        pages: z.number().int().nonnegative(),
        at: z.iso.datetime().nullable(),
      })
      .strict(),
    usage: z
      .object({
        /** Null when the counter can't be read right now. */
        answersToday: z.number().int().nonnegative().nullable(),
        limit: z.number().int().nonnegative(),
        resetsAt: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();

export type SiteAiCapabilities = z.infer<typeof siteAiCapabilitiesSchema>;
export type SiteAiStatus = z.infer<typeof siteAiStatusSchema>;

export const workspaceAiOverviewSchema = z
  .object({
    capabilities: siteAiCapabilitiesSchema,
    status: siteAiStatusSchema,
    selectedProvider: aiSelectionSchema,
    answersEnabled: z.boolean(),
    encryptionConfigured: z.boolean(),
    instanceConfigured: z.boolean(),
    instanceAnswersEnabled: z.boolean(),
    embeddingModel: z.string(),
    infrastructureConfigured: z.boolean(),
    providers: z.array(workspaceAiProviderSchema),
    index: z
      .object({
        published: z.boolean(),
        status: z.enum(['PENDING', 'RUNNING', 'READY', 'FAILED', 'DISABLED']).nullable(),
        errorCode: z.string().max(80).nullable(),
        pages: z.number(),
        chunks: z.number(),
      })
      .strict(),
    openaiOAuth: z
      .object({
        available: z.literal(false),
        reason: z.literal('registration_required'),
        documentation: z.literal('https://developers.openai.com/siwc/token-sharing-open-source'),
      })
      .strict(),
  })
  .strict();
export type WorkspaceAiProvider = z.infer<typeof workspaceAiProviderSchema>;
