import { useT } from '@nibleaf/i18n/react';
import type { McpKeyPreset } from '@nibleaf/shared/mcp';
import type { CreateMcpOAuthGrantBody } from '@nibleaf/validators';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';
import { queryKeys } from './query-keys';
import { connectedAppsQueryOptions } from './query-options';
import type { ConnectedApp } from './types';

/** What the OAuth project and consent pages show for one authorization request. */
export interface McpOAuthAuthorization {
  client: { clientId: string; name: string | null; uri: string | null; redirectTarget: string | null; verifiedDomain: string | null };
  requestedScopes: string[];
  projects: Array<{ id: string; name: string; slug: string; workspace: string; role: string; presets: McpKeyPreset[] }>;
  selection: { id: string; preset: McpKeyPreset; scopes: string[]; project: { id: string; name: string } } | null;
}

export const useConnectedApps = (projectId: string) => useQuery(connectedAppsQueryOptions(projectId));

export const useRevokeConnectedApp = (projectId: string) => {
  const queryClient = useQueryClient();
  const t = useT();
  const queryKey = queryKeys.connectedApps.all(projectId);
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData<ConnectedApp>(
        await api.app.projects[':projectId']['connected-apps'][':id'].$delete({ param: { projectId, id } }),
        t('settings.connectedApps.disconnectError'),
      ),
    // Optimistic: a disconnected app leaves the list (it only shows live
    // connections); the previous list comes back if the call fails.
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ConnectedApp[]>(queryKey);
      queryClient.setQueryData<ConnectedApp[]>(queryKey, (apps) => apps?.filter((app) => app.id !== id));
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
    meta: { errorMessage: t('settings.connectedApps.disconnectError') },
  });
};

export const useMcpOAuthAuthorization = (oauthQuery: string | null) =>
  useQuery({
    queryKey: queryKeys.mcpOAuth.authorization(oauthQuery ?? ''),
    enabled: Boolean(oauthQuery),
    retry: false,
    queryFn: async () =>
      getData<McpOAuthAuthorization>(
        await api.app['mcp-oauth'].authorization.$get({ query: { oauthQuery: oauthQuery ?? '' } }),
        'connection request',
      ),
  });

export const useCreateMcpOAuthGrant = (fallback: string) =>
  useMutation({
    mutationFn: async (body: CreateMcpOAuthGrantBody) =>
      mutateData<{ id: string; projectId: string; preset: McpKeyPreset; scopes: string[] }>(
        await api.app['mcp-oauth'].grants.$post({ json: body }),
        fallback,
      ),
  });
