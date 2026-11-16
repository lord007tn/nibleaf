import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';

/** The GitHub account a token belongs to. */
export type GitIdentity = { login: string; name: string | null };

/** One identity check: the token exactly as typed, for the site it was pressed on. */
type GitAuthorizationRequest = { projectId: string; token: string };

/**
 * Checks which GitHub account a token belongs to. The server only reads the
 * account; nothing is stored until Connect. A success refreshes the request's
 * site, whatever site the page shows by then, and settles only after that read.
 * Not retried.
 */
export function useGitAuthorization() {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: async ({ projectId, token }: GitAuthorizationRequest) =>
      mutateData<GitIdentity>(
        await api.app.projects[':projectId'].git.authorize.$post({ param: { projectId }, json: { token } }),
        'Could not authorize the GitHub account.',
      ),
    onSuccess: (_identity, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail(projectId) }),
  });
  return mutateAsync;
}
