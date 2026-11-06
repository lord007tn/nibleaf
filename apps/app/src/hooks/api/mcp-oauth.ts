import type { McpKeyPreset } from '@nibleaf/shared/mcp';
import type { CreateMcpOAuthGrantBody } from '@nibleaf/validators';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';
import { queryKeys } from './query-keys';

/** One AI app connected to a project by signing in (an OAuth connection). */
export interface ConnectedApp {
  id: string;
  name: string;
  uri: string | null;
  preset: McpKeyPreset;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  connectedBy: { id: string; name: string; email: string };
  ownedByViewer: boolean;
  lastActivity: { operation: string; outcome: string; at: string } | null;
}

/** What the OAuth project and consent pages show for one authorization request. */
export interface McpOAuthAuthorization {
  client: { clientId: string; name: string | null; uri: string | null; redirectTarget: string | null; verifiedDomain: string | null };
  requestedScopes: string[];
  projects: Array<{ id: string; name: string; role: string; presets: McpKeyPreset[] }>;
  selection: { id: string; preset: McpKeyPreset; scopes: string[]; project: { id: string; name: string } } | null;
}

export const useConnectedApps = (projectId: string) =>
  useQuery({
    queryKey: queryKeys.connectedApps.all(projectId),
    queryFn: async () =>
      getData<ConnectedApp[]>(await api.app.projects[':projectId']['connected-apps'].$get({ param: { projectId } }), 'connected apps'),
  });

export const useRevokeConnectedApp = (projectId: string, fallback: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData<ConnectedApp>(await api.app.projects[':projectId']['connected-apps'][':id'].$delete({ param: { projectId, id } }), fallback),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.connectedApps.all(projectId) }),
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
