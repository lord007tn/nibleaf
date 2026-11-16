import type { GitConnectionBody } from '@nibleaf/validators';
import { useQueryClient as useCacheClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { ApiResponseError, mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionQueryClient } from '@/integrations/tanstack-query/session-cache';
import { getSessionGeneration } from '@/integrations/tanstack-query/session-generation';
import { api } from '@/services/api';
import { isWritingConnection, startConnectionWrite, useWritingConnection } from './git-connection-writes';

/** What the first `PUT /git/connection` answers: the stored connection (redacted) and the webhook secret it generated. */
export type GitFirstConnectResult = { connection: unknown; webhookSecret: string | null };

const FAILED = 'Could not connect the repository.';

/**
 * The error a refused Connect reports: only the HTTP status and a numeric
 * `Retry-After`, never the server's message, code, reason or details, any of
 * which could echo the token sent.
 */
const sanitized = (error: unknown) => {
  if (error instanceof ApiResponseError) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    const retryAfter = error.retryAfter && /^\d{1,6}$/.test(error.retryAfter) ? error.retryAfter : undefined;
    return new ApiResponseError(FAILED, status, undefined, retryAfter);
  }
  return error instanceof TypeError ? new TypeError(FAILED) : new Error(FAILED);
};

/**
 * The connect wizard's final Connect: the first `PUT /git/connection` of a
 * site, which stores the token and answers with the one-time webhook secret.
 *
 * A direct request, not a TanStack mutation: the body (and so the token) is
 * held only by this call, and the answer (and so the secret) only by its
 * caller. No mutation, option, cached closure or error in any cache holds
 * either, and a refusal comes back sanitized. Never retried, paused or
 * replayed: offline, it fails and the person presses again.
 *
 * `connect(projectId, body)` sends `body` exactly as given. On success it
 * refreshes that site's status, whatever the page shows by then, and resolves
 * after that read. It resolves to null, sending, refreshing or reporting
 * nothing (more), while another write of the site's connection is in flight
 * (checked in the same tick, so presses in one tick send once), or once the
 * session this hook was mounted in has ended (AppGuard remounts the dashboard
 * for the next one).
 *
 * `pending` says whether a write of `projectId`'s connection is in flight from
 * any instance in this session (`git-connection-writes.ts`), until the request
 * and the refresh after a success end.
 */
export function useGitFirstConnect(projectId: string) {
  const cache = useCacheClient();
  const client = useSessionQueryClient();
  const generation = useMemo(() => getSessionGeneration(cache), [cache]);
  const pending = useWritingConnection(cache, generation, projectId);

  const connect = useCallback(
    async (site: string, body: GitConnectionBody): Promise<GitFirstConnectResult | null> => {
      const current = () => getSessionGeneration(cache) === generation;
      if (!current() || isWritingConnection(cache, generation, site)) return null;
      const release = startConnectionWrite(cache, generation, site);
      try {
        let result: GitFirstConnectResult;
        try {
          result = await mutateData<GitFirstConnectResult>(
            await api.app.projects[':projectId'].git.connection.$put({ param: { projectId: site }, json: body }),
            FAILED,
          );
        } catch (error) {
          if (!current()) return null;
          throw sanitized(error);
        }
        if (!current()) return null;
        await client.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail(site) });
        return current() ? result : null;
      } finally {
        release();
      }
    },
    [cache, client, generation],
  );

  return { connect, pending };
}
