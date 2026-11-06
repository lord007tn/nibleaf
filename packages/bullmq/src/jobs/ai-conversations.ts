import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { aiChatEventRowSchema } from '@nibleaf/clickhouse';
import { z } from 'zod';

const keySchema = z.string().refine((value) => Buffer.from(value, 'base64').length === 32);
export const resolveAiConversationKey = (
  config: { AI_CONVERSATION_ENCRYPTION_KEY?: string; INTEGRATION_CREDENTIAL_ENCRYPTION_KEY?: string } = process.env,
): Buffer | null => {
  if (config.AI_CONVERSATION_ENCRYPTION_KEY) return Buffer.from(keySchema.parse(config.AI_CONVERSATION_ENCRYPTION_KEY), 'base64');
  if (!config.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY) return null;
  return createHmac('sha256', Buffer.from(keySchema.parse(config.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY), 'base64'))
    .update('nibleaf:ai-conversation-archive:v1')
    .digest();
};
export const aiConversationJobSchema = z
  .object({
    kind: z.enum(['ai-conversation-turn', 'ai-conversation-feedback']),
    tenantId: z.string().min(1),
    projectId: z.string().min(1),
    sealed: z.string().min(1),
  })
  .strict();
export const aiChatEventsJobSchema = z
  .object({
    kind: z.literal('ai-chat-events'),
    tenantId: z.string().min(1),
    projectId: z.string().min(1),
    rows: z.array(aiChatEventRowSchema).min(1).max(20),
  })
  .strict();
export type AiConversationJobData = z.infer<typeof aiConversationJobSchema> | z.infer<typeof aiChatEventsJobSchema>;
// The existing shared credential envelope does not support authenticated associated data.
export const sealAiConversation = (value: unknown, tenantId: string, projectId: string, key: Buffer): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${tenantId}:${projectId}`));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
};
export const openAiConversation = (sealed: string, tenantId: string, projectId: string, key: Buffer): unknown => {
  const [v, iv, tag, data, extra] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !data || extra !== undefined) throw new Error('archive envelope');
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  cipher.setAAD(Buffer.from(`${tenantId}:${projectId}`));
  cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString('utf8'));
};

/** Metadata still needs queue encryption when transcript capture has no archive key. */
export const resolveAiConversationTransportKey = (config: {
  AI_CONVERSATION_ENCRYPTION_KEY?: string;
  INTEGRATION_CREDENTIAL_ENCRYPTION_KEY?: string;
  ANALYTICS_HASH_SALT?: string;
}): Buffer => {
  const archiveKey = resolveAiConversationKey(config);
  if (archiveKey) return archiveKey;
  if (!config.ANALYTICS_HASH_SALT) throw new Error('archive transport configuration');
  return createHmac('sha256', config.ANALYTICS_HASH_SALT).update('nibleaf:ai-conversation-metadata:v1').digest();
};
