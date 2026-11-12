import { useQuery, useQueryClient } from '@tanstack/react-query';
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

/**
 * Checks a key with its provider and lists the models it offers. A new key
 * isn't saved; checking the saved key records what the check learned (works,
 * refused, out of credit, model withdrawn), so the page's status is read again
 * once the check settles either way.
 */
export const useAiKeyModels = (projectId: string) => {
  const client = useQueryClient();
  const models = useWorkspaceAiModels(projectId);
  const refresh = (body: { apiKey?: string }) => {
    if (!body.apiKey) void client.invalidateQueries({ queryKey: workspaceAiQueryOptions(projectId).queryKey });
  };
  return {
    ...models,
    mutate: (body: Parameters<typeof models.mutate>[0], options?: Parameters<typeof models.mutate>[1]) =>
      models.mutate(body, {
        ...options,
        onSettled: (...args) => {
          refresh(body);
          options?.onSettled?.(...args);
        },
      }),
  };
};

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
