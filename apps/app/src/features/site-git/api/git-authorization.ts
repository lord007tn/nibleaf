import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionQueryClient } from '@/integrations/tanstack-query/session-cache';
import { getSessionGeneration } from '@/integrations/tanstack-query/session-generation';
import { api } from '@/services/api';

/** The GitHub account a token belongs to. */
export type GitIdentity = { login: string; name: string | null };

/**
 * Checks which GitHub account a token belongs to: the token exactly as given,
 * for the given site. The server only reads the account; nothing is stored
 * until Connect.
 *
 * A direct request, not a TanStack mutation: the token never enters the
 * MutationCache (variables, errors, dehydration), only this call. A success
 * refreshes the request's site, whatever the page shows by then, and resolves
 * only after that read. Not retried, never paused or replayed.
 *
 * Resolves to null, sending nothing or refreshing nothing, once the session
 * the hook was mounted in has ended (AppGuard remounts the dashboard for the
 * next one). A refusal rejects; callers report it without its body.
 */
export function useGitAuthorization() {
  const client = useQueryClient();
  const queryClient = useSessionQueryClient();
  const generation = useMemo(() => getSessionGeneration(client), [client]);
  return useCallback(
    async (projectId: string, token: string): Promise<GitIdentity | null> => {
      const current = () => generation === getSessionGeneration(client);
      if (!current()) return null;
      const identity = await mutateData<GitIdentity>(
        await api.app.projects[':projectId'].git.authorize.$post({ param: { projectId }, json: { token } }),
        'Could not authorize the GitHub account.',
      );
      if (!current()) return null;
      await queryClient.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail(projectId) });
      return identity;
    },
    [client, queryClient, generation],
  );
}
