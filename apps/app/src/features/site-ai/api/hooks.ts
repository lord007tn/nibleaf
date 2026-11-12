import { useQuery } from '@tanstack/react-query';
import { useCreateProjectSearchReindex } from '@/hooks/api';
import { workspaceAiQueryOptions } from '@/hooks/api/query-options';
import { useSaveWorkspaceAiConnection, useSelectWorkspaceAi, useWorkspaceAiModels } from '@/hooks/api/workspace-ai';
import { siteAiQueryOptions } from './query-options';

/** The site's AI answers capabilities, status and the viewer's permissions (see `model/ai.ts` for what the page makes of them). */
export const useSiteAi = (projectId: string) => useQuery(siteAiQueryOptions(projectId));

/**
 * Saves the site's source and its answers switch (`PATCH …/settings/ai`; body
 * from `switchRequest` or `sourceChoiceRequest`). Class: server-confirmed
 * (operations/ui-overhaul.md §8.2): the result replaces the cached overview, and
 * failures are toasted once by the shared mutation.
 */
export const useSelectAiSource = (projectId: string) => useSelectWorkspaceAi(projectId);

/** Queues preparing the published docs for AI (a search reindex); the overview then follows the run. */
export const usePrepareDocsForAi = (projectId: string) => useCreateProjectSearchReindex(projectId);

/** Checks a key with its provider and lists the models it offers (nothing is saved). */
export const useAiKeyModels = (projectId: string) => useWorkspaceAiModels(projectId);

/** Saves a key (or a new model for a saved key) after checking it with the provider. */
export const useSaveAiKey = (projectId: string) => useSaveWorkspaceAiConnection(projectId);

/**
 * A provider's saved connection as the key form edits it (configured, revision,
 * model), and whether keys can be saved at all, from the same cache entry.
 */
export const useAiKeyConnection = (projectId: string, providerId: 'openai' | 'openrouter') =>
  useQuery({
    ...workspaceAiQueryOptions(projectId),
    select: (data) => ({
      connection: data.providers.find((provider) => provider.id === providerId) ?? null,
      canSave: data.encryptionConfigured,
    }),
  });
