import type { ProjectIntegration } from '@nibleaf/database';
import { keys as searchKeys } from '@nibleaf/search/keys';
import { aiConnectionConfigSchema, aiCredentialSchema, aiSelectionSchema } from '@nibleaf/shared/ai';
import { z } from 'zod';
import { env } from '@/env';
import { decryptIntegrationSecret } from './integrations/crypto';

/**
 * Which AI answers a site's readers, and whether it can: one set of rules for
 * every screen that reports it (Integrations cards, the AI answers page). They
 * mirror the reader's resolver, `resolveWorkspaceAiConfiguration` in
 * packages/search/src/workspace.ts, so no screen says "on" while readers get
 * nothing.
 */

export type AiKeyProvider = 'openai' | 'openrouter';
type StoredAiKey = Pick<ProjectIntegration, 'projectId' | 'status' | 'lastVerificationStatus' | 'config' | 'credentialEncrypted'>;

const siteAiSelectionSchema = z.object({
  search: z.object({ aiProvider: aiSelectionSchema.optional(), aiAnswers: z.boolean().optional() }).optional(),
});

/** The site's saved choice: its source (the server's provider by default) and its answers switch. */
export const siteAiSelection = (projectConfig: unknown) => {
  const search = siteAiSelectionSchema.safeParse(projectConfig).data?.search;
  return { source: search?.aiProvider ?? 'instance', answersOn: search?.aiAnswers === true };
};

/** The server's own provider can answer: it holds a key and allows answers. */
export const managedAiServes = () => Boolean(env.OPENROUTER_API_KEY) && searchKeys().SEARCH_ANSWER_ENABLED;

/** Whether the reader could decrypt this stored key for this site and provider (never returns the key). */
const storedAiKeyReadable = (stored: Pick<StoredAiKey, 'projectId' | 'credentialEncrypted'>, providerId: AiKeyProvider) => {
  try {
    const credential = aiCredentialSchema.parse(JSON.parse(decryptIntegrationSecret(stored.credentialEncrypted)));
    return credential.projectId === stored.projectId && credential.providerId === providerId;
  } catch {
    return false;
  }
};

/**
 * Whether a site's stored key can answer readers, by the reader's own checks:
 * - `rejected`: switched off, marked broken, or it failed its last check;
 * - `needsRecheck`: it was checked for another embedding model than the server uses now;
 * - `unreadable`: it can't be decrypted for this site with the current keyring;
 * - `ok`: usable.
 */
export const storedAiKeyState = (stored: StoredAiKey, providerId: AiKeyProvider): 'ok' | 'rejected' | 'needsRecheck' | 'unreadable' => {
  if (stored.status !== 'ACTIVE' || stored.lastVerificationStatus !== 'HEALTHY') return 'rejected';
  const embeddingModel = aiConnectionConfigSchema.safeParse(stored.config).data?.embeddingModel;
  if (embeddingModel !== searchKeys().SEARCH_EMBEDDING_MODEL || (providerId === 'openai' && !embeddingModel.startsWith('openai/'))) {
    return 'needsRecheck';
  }
  return storedAiKeyReadable(stored, providerId) ? 'ok' : 'unreadable';
};

/**
 * One AI source's status for a site:
 * - `active` only while readers of this site get answers from it: it is the
 *   selected source, answers are on, and it can serve;
 * - `error` when a stored key is selected and on but can't serve, or was marked broken;
 * - `inactive` otherwise (a saved key that isn't the source, or answers off).
 * Holding a key never makes a source active on its own.
 */
export const aiSourceStatus = (source: 'instance' | AiKeyProvider, projectConfig: unknown, stored?: StoredAiKey): 'active' | 'inactive' | 'error' => {
  const selection = siteAiSelection(projectConfig);
  const selectedAndOn = selection.source === source && selection.answersOn;
  if (source === 'instance') return selectedAndOn && managedAiServes() ? 'active' : 'inactive';
  if (stored?.status === 'ERROR') return 'error';
  if (!selectedAndOn) return 'inactive';
  return stored && storedAiKeyState(stored, source) === 'ok' ? 'active' : 'error';
};
