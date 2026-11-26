import { hashKey, type Query, type QueryClient, useQueryClient as useCacheClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { GitWorkflowStatus } from '@/hooks/api';
import { ApiResponseError, mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { gitWorkflowQueryOptions } from '@/hooks/api/query-options';
import { useSessionQueryClient } from '@/integrations/tanstack-query/session-cache';
import { getSessionGeneration } from '@/integrations/tanstack-query/session-generation';
import { api } from '@/services/api';
import { type GitWorkflowConnectionValues, gitWorkflowConnectionPayload, type StoredGitWorkflowConnection } from '../model/git-workflow-connection';
import { isWritingConnection, startConnectionWrite, useWritingConnection } from './git-connection-writes';

/**
 * A connection save: the site it is for, the settings as typed, and the
 * `settingsRevision` of the connection the form shows (what those settings
 * were edited from). The token goes beside it, never in it.
 */
export type GitWorkflowConnectionSave = { projectId: string; values: GitWorkflowConnectionValues; expectedRevision?: number };

/** What `PUT /git/connection` answers: the stored connection (redacted) and a webhook secret only when it made one. */
export type GitWorkflowConnectionResult = { connection: StoredGitWorkflowConnection; webhookSecret: string | null };

const FAILED = 'Could not connect the repository.';

/** Thrown once the session a save started in has ended: nothing more is read or sent for it. */
const obsolete = () => new Error(FAILED);

/**
 * Waits for a read of the site's status that the cache adopts: the read in
 * flight, or a new one when none is. Adopted means that query's own fetch
 * completed (a `success` that isn't a manual `setQueryData` write); it then
 * gives the status that fetch stored. Not adopted: the read failed, paused
 * offline, was removed, or was cancelled back to the data it started from
 * (whose targets are then not known to be current).
 */
function adoptedRead(client: QueryClient, projectId: string) {
  const options = gitWorkflowQueryOptions(projectId);
  const hash = hashKey(options.queryKey);
  return new Promise<{ adopted: true; status: GitWorkflowStatus | null } | { adopted: false }>((resolve) => {
    // The query whose fetch this read joined or started; events of any other query object are not its outcome.
    let joined: Query | undefined;
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (!joined || event.query !== joined) return;
      let adopted: boolean | undefined;
      if (event.type === 'removed') adopted = false;
      else if (event.type === 'updated') {
        const { action } = event;
        if (action.type === 'success') adopted = action.manual ? undefined : true;
        else if (action.type === 'error' || action.type === 'pause' || (action.type === 'setState' && joined.state.fetchStatus === 'idle'))
          adopted = false;
      }
      if (adopted === undefined) return;
      unsubscribe();
      resolve(adopted ? { adopted, status: joined.state.data as GitWorkflowStatus | null } : { adopted });
    });
    // Joins the read in flight (a refresh, a poll, an invalidation), or starts one; either way, that query's fetch.
    client.fetchQuery({ ...options, staleTime: 0 }).catch(() => undefined);
    joined = client.getQueryCache().get(hash);
    // No query to watch, or one already paused offline, tells nothing more now.
    if (!joined || joined.state.fetchStatus === 'paused') {
      unsubscribe();
      resolve({ adopted: false });
    }
  });
}

/**
 * The site's status as last confirmed, for the import targets a save sends
 * back: the cached status while nothing is reading it and it is valid;
 * otherwise the read in flight, or a new one, once the cache adopts it. A read
 * that isn't adopted is followed by one more; if that isn't adopted either,
 * the save fails rather than send targets that may be stale. `current` is
 * checked before each read starts and after each ends: once the session the
 * save started in has ended, nothing more is read.
 */
async function latestConfirmedStatus(client: QueryClient, projectId: string, current: () => boolean) {
  if (!current()) throw obsolete();
  const state = client.getQueryCache().find<GitWorkflowStatus | null>({ queryKey: gitWorkflowQueryOptions(projectId).queryKey, exact: true })?.state;
  if (state && state.data !== undefined && state.fetchStatus === 'idle' && !state.isInvalidated) return state.data;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!current()) throw obsolete();
    const read = await adoptedRead(client, projectId);
    if (!current()) throw obsolete();
    if (read.adopted) return read.status;
  }
  throw new Error(FAILED);
}

/**
 * The error a save reports. Only what is known safe is kept: the HTTP status
 * (a number) and a numeric `Retry-After`. Never the server's message, body,
 * code, reason or details, any of which could echo what was sent. This route
 * returns no code or reason that the friendly message maps (its codes are
 * `http:bad_request`, `database:not_found`, auth and validation ones), so the
 * message shown is the one the full error gave.
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
 * Saves a connected site's GitHub connection settings (Connection
 * configuration). Class: form save, not optimistic. A direct request, not a
 * mutation: the token is sent only in its body, so no cache, mutation, option
 * or retained closure ever holds it, and a failure comes back sanitized.
 *
 * `save(request, token)`:
 * - sends the import branch and language as the site's latest confirmed status
 *   holds them (`latestConfirmedStatus`);
 * - sends the token only when one was typed;
 * - sends the form's revision, so a save another person committed after the
 *   form loaded is refused (409) instead of replaced (#876). That refusal
 *   refreshes the site's status, so the form shows the other save (its
 *   changed fields, or a conflict where both changed one) before a new try;
 * - on success, refreshes the status of the site the request was for, whatever
 *   the page shows by then, and resolves after that read with the PUT's
 *   answer; any other failure refreshes nothing;
 * - is never retried; once the session this hook belongs to has ended, it
 *   reads, sends and refreshes nothing.
 *
 * `pending` and `isPending()` say whether a write of `projectId`'s connection
 * (a save, or the first Connect) is in flight from any instance in this
 * session (`git-connection-writes.ts`): `pending` for rendering, `isPending()`
 * for a press, which reads it in the same tick. Each releases only when its
 * request (and the refresh after a success) ends.
 */
export function useSaveGitWorkflowConnection(projectId: string) {
  const cache = useCacheClient();
  const client = useSessionQueryClient();
  // The session this hook belongs to (dashboard hooks remount for another account); a save from it after that
  // session ended reads and sends nothing.
  const generation = useMemo(() => getSessionGeneration(cache), [cache]);
  const pending = useWritingConnection(cache, generation, projectId);

  const save = useCallback(
    async (request: GitWorkflowConnectionSave, token?: string): Promise<GitWorkflowConnectionResult> => {
      const current = () => getSessionGeneration(cache) === generation;
      if (!current()) throw obsolete();
      const release = startConnectionWrite(cache, generation, request.projectId);
      try {
        const status = await latestConfirmedStatus(client, request.projectId, current);
        // Even a status taken from the cache resumes after a turn: a session that ended meanwhile sends nothing.
        if (!current()) throw obsolete();
        let result: GitWorkflowConnectionResult;
        try {
          result = await mutateData<GitWorkflowConnectionResult>(
            await api.app.projects[':projectId'].git.connection.$put({
              param: { projectId: request.projectId },
              json: gitWorkflowConnectionPayload(request.values, status, token, request.expectedRevision),
            }),
            FAILED,
          );
        } catch (error) {
          const refused = sanitized(error);
          if (refused instanceof ApiResponseError && refused.status === 409 && current()) {
            await client.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail(request.projectId) }).catch(() => undefined);
          }
          throw refused;
        }
        await client.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail(request.projectId) });
        return result;
      } finally {
        release();
      }
    },
    [cache, client, generation],
  );

  return { save, pending, isPending: () => isWritingConnection(cache, generation, projectId) };
}
