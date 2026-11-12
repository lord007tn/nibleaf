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
        /** `noDailyAnswers`: the server's daily answer limit is 0. */
        reason: z.enum(['noServerKey', 'answersDisabledOnServer', 'noDailyAnswers']).nullable(),
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
    /**
     * Answers need search on this server, serving the collection built for its
     * current embedding settings (after an embedding change it serves the old
     * one until the operator reindexes and switches it: `searchIndexSwitching`).
     */
    answers: z.object({ available: z.boolean(), reason: z.enum(['searchNotConfigured', 'searchIndexSwitching']).nullable() }).strict(),
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
          /** The stored connection's revision, which choosing this key as the source must name. */
          revision: z.number().int().positive(),
          /**
           * Whether it answers readers, from the reader's own checks and from
           * what its last check or reader request learned. `rateLimited` still
           * serves; `outOfCredit` and `rejected` rest, and readers try them again after a cooldown.
           */
          state: z.enum(['ok', 'rateLimited', 'rejected', 'outOfCredit', 'unreachable', 'modelWithdrawn', 'needsRecheck', 'unreadable']),
          /**
           * What went wrong at its last check or reader request, as a code
           * (never provider error text, which can carry secrets), and when.
           */
          failure: z
            .object({
              reason: z.enum(['keyRefused', 'outOfCredit', 'rateLimited', 'providerUnreachable', 'modelWithdrawn', 'checkFailed']),
              checkedAt: z.iso.datetime().nullable(),
            })
            .strict()
            .nullable(),
          /** Last four characters, for site Admins only. */
          keyHint: z.string().max(4).nullable(),
          /** When the current key was added; null when that is not known (keys saved before it was recorded). */
          addedAt: z.iso.datetime().nullable(),
          model: aiModelRefSchema.nullable(),
        })
        .strict(),
    ),
    published: z.object({ version: z.number().int(), at: z.iso.datetime().nullable() }).strict().nullable(),
    preparation: z
      .object({
        /** `partial`: finished, but some pages could not be prepared; the rest answer. */
        state: z.enum(['none', 'running', 'ready', 'partial', 'failed']),
        pages: z.number().int().nonnegative(),
        expectedPages: z.number().int().nonnegative(),
        at: z.iso.datetime().nullable(),
      })
      .strict(),
    usage: z
      .object({
        /** Completed answers, for display. Null when the counter can't be read right now. */
        answersToday: z.number().int().nonnegative().nullable(),
        /**
         * Requests the daily quota counted (failed generations included). Readers are
         * refused once it reaches `limit`, so the limit state comes from this.
         */
        spent: z.number().int().nonnegative().nullable(),
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
    /** What the person asking may change; everyone on the site may read. */
    viewer: z.object({ canManage: z.boolean() }).strict(),
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
