import { INTEGRATION_PROVIDER_IDS } from '@nibleaf/shared/integrations';
import { z } from 'zod';

export const integrationProviderIdSchema = z.enum(INTEGRATION_PROVIDER_IDS);
export const configurableIntegrationProviderIdSchema = z.enum(['slack', 'discord', 'zapier']);

const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9._-]+$/);

const labelSchema = z.string().trim().min(1).max(80).optional();

const slackWebhookUrl = z
  .url()
  .max(1000)
  .refine((value) => {
    const url = URL.parse(value);
    return (
      url !== null &&
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.hostname === 'hooks.slack.com' &&
      url.pathname.startsWith('/services/')
    );
  }, 'Use a Slack incoming webhook URL.');

const discordWebhookUrl = z
  .url()
  .max(1000)
  .refine((value) => {
    const url = URL.parse(value);
    return (
      url !== null &&
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      ['discord.com', 'discordapp.com'].includes(url.hostname) &&
      /^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)
    );
  }, 'Use a Discord webhook URL.');

const zapierWebhookUrl = z
  .url()
  .max(1000)
  .refine((value) => {
    const url = URL.parse(value);
    return (
      url !== null &&
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.hostname === 'hooks.zapier.com' &&
      url.pathname.startsWith('/hooks/catch/')
    );
  }, 'Use a Zapier Catch Hook URL.');

export const createProjectIntegrationBody = z.discriminatedUnion('providerId', [
  z.object({ providerId: z.literal('slack'), webhookUrl: slackWebhookUrl, label: labelSchema, idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ providerId: z.literal('discord'), webhookUrl: discordWebhookUrl, label: labelSchema, idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ providerId: z.literal('zapier'), webhookUrl: zapierWebhookUrl, label: labelSchema, idempotencyKey: idempotencyKeySchema }).strict(),
]);
export type CreateProjectIntegrationBody = z.infer<typeof createProjectIntegrationBody>;

const updateFields = {
  label: z.string().trim().min(1).max(80).nullable().optional(),
  replaceCredential: z.literal(true).optional(),
  expectedRevision: z.number().int().positive(),
  idempotencyKey: idempotencyKeySchema,
};

export const updateProjectIntegrationBody = z
  .discriminatedUnion('providerId', [
    z.object({ providerId: z.literal('slack'), webhookUrl: slackWebhookUrl.optional(), ...updateFields }).strict(),
    z.object({ providerId: z.literal('discord'), webhookUrl: discordWebhookUrl.optional(), ...updateFields }).strict(),
    z.object({ providerId: z.literal('zapier'), webhookUrl: zapierWebhookUrl.optional(), ...updateFields }).strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.webhookUrl && value.replaceCredential !== true) {
      ctx.addIssue({ code: 'custom', path: ['replaceCredential'], message: 'Explicit credential replacement confirmation is required.' });
    }
  });
export type UpdateProjectIntegrationBody = z.infer<typeof updateProjectIntegrationBody>;

export const integrationRevisionBody = z.object({ expectedRevision: z.number().int().positive(), idempotencyKey: idempotencyKeySchema }).strict();
export type IntegrationRevisionBody = z.infer<typeof integrationRevisionBody>;

const projectConnectionVerification = {
  expectedRevision: z.number().int().positive(),
  idempotencyKey: idempotencyKeySchema,
  confirmExternalSideEffect: z.boolean().optional(),
};

export const verifyProjectIntegrationBody = z.discriminatedUnion('providerId', [
  z.object({ providerId: z.literal('github') }).strict(),
  z.object({ providerId: z.literal('slack'), ...projectConnectionVerification }).strict(),
  z.object({ providerId: z.literal('discord'), ...projectConnectionVerification }).strict(),
  z.object({ providerId: z.literal('zapier'), ...projectConnectionVerification }).strict(),
]);
export type VerifyProjectIntegrationBody = z.infer<typeof verifyProjectIntegrationBody>;

export const createIntegrationDeleteConfirmationBody = z
  .object({
    expectedRevision: z.number().int().positive(),
    apiKeyId: z.string().min(1).max(120).optional(),
  })
  .strict();
export type CreateIntegrationDeleteConfirmationBody = z.infer<typeof createIntegrationDeleteConfirmationBody>;

export const deleteProjectIntegrationBody = z.object({ confirmationToken: z.string().min(32).max(512) }).strict();
export type DeleteProjectIntegrationBody = z.infer<typeof deleteProjectIntegrationBody>;

const integrationPublicConfigSchema = z.discriminatedUnion('providerId', [
  z
    .object({ providerId: z.literal('github'), repository: z.string(), baseBranch: z.string(), headBranch: z.string(), contentPath: z.string() })
    .strict(),
  z.object({ providerId: z.enum(['gitlab', 'public-git']), repository: z.string(), branch: z.string(), contentPath: z.string() }).strict(),
  z.object({ providerId: z.literal('google-analytics'), measurementId: z.string() }).strict(),
  z.object({ providerId: z.literal('plausible'), domain: z.string() }).strict(),
  z.object({ providerId: z.enum(['slack', 'discord', 'zapier']), label: z.string().nullable() }).strict(),
  z.object({ providerId: z.literal('openrouter'), draftModel: z.string(), embeddingModel: z.string(), answerModel: z.string() }).strict(),
  z.object({ providerId: z.literal('qdrant'), collectionAlias: z.string(), searchRuntime: z.enum(['legacy', 'shadow', 'hybrid']) }).strict(),
  z.object({ providerId: z.literal('clickhouse'), mode: z.enum(['disabled', 'dual_write', 'shadow_read', 'clickhouse']) }).strict(),
  z.object({ providerId: z.literal('postmark'), messageStream: z.string().nullable() }).strict(),
  z.object({ providerId: z.literal('smtp') }).strict(),
  z.object({ providerId: z.enum(['maxio', 'minio', 'amazon-s3', 'cloudflare-r2', 'backblaze-b2']) }).strict(),
  z.object({ providerId: z.literal('cloudflare'), workerScript: z.string() }).strict(),
]);

/** Strict secret-free persisted replay DTO. Adding a new provider requires an
 * explicit allowlisted public config branch here. */
export const integrationConnectionSummarySchema = z
  .object({
    id: z.string(),
    providerId: integrationProviderIdSchema,
    category: z.enum(['source_control', 'deployment', 'ai', 'email', 'analytics', 'storage', 'webhook']),
    ownership: z.enum(['project', 'instance']),
    status: z.enum(['active', 'inactive', 'error']),
    health: z
      .object({ status: z.enum(['unverified', 'healthy', 'unhealthy']), checkedAt: z.iso.datetime().nullable(), code: z.string().nullable() })
      .strict(),
    credential: z.object({ configured: z.boolean() }).strict().nullable(),
    config: integrationPublicConfigSchema,
    revision: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
