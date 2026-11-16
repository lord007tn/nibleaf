import { hashKey, type QueryClient, useQueryClient as useCacheClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import type { GitWorkflowStatus } from '@/hooks/api';
import { ApiResponseError, mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { gitWorkflowQueryOptions } from '@/hooks/api/query-options';
import { useSessionQueryClient } from '@/integrations/tanstack-query/session-cache';
import { getSessionGeneration } from '@/integrations/tanstack-query/session-generation';
import { api } from '@/services/api';
import { type GitWorkflowConnectionValues, gitWorkflowConnectionPayload, type StoredGitWorkflowConnection } from '../model/git-workflow-connection';

/** A connection save: the site it is for and the settings as typed. The token goes beside it, never in it. */
export type GitWorkflowConnectionSave = { projectId: string; values: GitWorkflowConnectionValues };

/** What `PUT /git/connection` answers: the stored connection (redacted) and a webhook secret only when it made one. */
export type GitWorkflowConnectionResult = { connection: StoredGitWorkflowConnection; webhookSecret: string | null };

const FAILED = 'Could not connect the repository.';

/**
 * The saves in flight, per query client, session and site: a count, nothing
 * else (no request, values or token), so a save started before leaving and
 * coming back to a site still makes it busy, and another account's never does.
 */
type Saving = { counts: Map<string, number>; listeners: Set<() => void> };
const savingByClient = new WeakMap<QueryClient, Saving>();
const savingOf = (client: QueryClient): Saving => {
  let saving = savingByClient.get(client);
  if (!saving) {
    saving = { counts: new Map(), listeners: new Set() };
    savingByClient.set(client, saving);
  }
  return saving;
};
const slot = (client: QueryClient, projectId: string) => JSON.stringify([getSessionGeneration(client), projectId]);
const isSaving = (client: QueryClient, projectId: string) => (savingOf(client).counts.get(slot(client, projectId)) ?? 0) > 0;
const track = (client: QueryClient, key: string, change: 1 | -1) => {
  const { counts, listeners } = savingOf(client);
  const count = (counts.get(key) ?? 0) + change;
  if (count > 0) counts.set(key, count);
  else counts.delete(key);
  for (const listener of listeners) listener();
};

/**
 * Waits for a read of the site's status that the cache adopts: the read in
 * flight, or a new one when none is. True with the status it stored; false
 * when that read failed, paused offline, was removed, or was cancelled back to
 * the data it started from (whose targets are then not known to be current).
 */
function adoptedRead(client: QueryClient, projectId: string) {
  const options = gitWorkflowQueryOptions(projectId);
  const hash = hashKey(options.queryKey);
  return new Promise<{ adopted: true; status: GitWorkflowStatus | null } | { adopted: false }>((resolve) => {
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryHash !== hash) return;
      let adopted: boolean | undefined;
      if (event.type === 'removed') adopted = false;
      else if (event.type === 'updated') {
        const { type } = event.action;
        if (type === 'success') adopted = true;
        else if (type === 'error' || type === 'pause' || (type === 'setState' && event.query.state.fetchStatus === 'idle')) adopted = false;
      }
      if (adopted === undefined) return;
      unsubscribe();
      resolve(adopted ? { adopted, status: event.query.state.data as GitWorkflowStatus | null } : { adopted });
    });
    // Joins the read in flight (a refresh, a poll, an invalidation), or starts one. One already paused offline
    // tells nothing more until the connection is back.
    client.fetchQuery({ ...options, staleTime: 0 }).catch(() => undefined);
    if (client.getQueryCache().get(hash)?.state.fetchStatus === 'paused') {
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
 * the save fails rather than send targets that may be stale.
 */
async function latestConfirmedStatus(client: QueryClient, projectId: string) {
  const state = client.getQueryCache().find<GitWorkflowStatus | null>({ queryKey: gitWorkflowQueryOptions(projectId).queryKey, exact: true })?.state;
  if (state && state.data !== undefined && state.fetchStatus === 'idle' && !state.isInvalidated) return state.data;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const read = await adoptedRead(client, projectId);
    if (read.adopted) return read.status;
  }
  throw new Error(FAILED);
}

/**
 * The error a save reports: its status and code, so the caller's friendly
 * message is the one it was, but never the server's message or body, which
 * could echo what was sent.
 */
const sanitized = (error: unknown) => {
  if (error instanceof ApiResponseError) {
    const reason = error.reason;
    return new ApiResponseError(FAILED, error.status, error.code, error.retryAfter, undefined, undefined, undefined, reason ? { reason } : undefined);
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
 * - on success, refreshes the status of the site the request was for, whatever
 *   the page shows by then, and resolves after that read with the PUT's
 *   answer; a failure refreshes nothing;
 * - is never retried, and does nothing to the cache once the account changed.
 *
 * `pending` and `isPending()` say whether a save for `projectId` is in flight
 * from any instance in this session: `pending` for rendering, `isPending()`
 * for a press, which reads it in the same tick. Each releases only when its
 * request (and the refresh after a success) ends.
 */
export function useSaveGitWorkflowConnection(projectId: string) {
  const cache = useCacheClient();
  const client = useSessionQueryClient();
  const subscribe = useCallback(
    (listener: () => void) => {
      const { listeners } = savingOf(cache);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [cache],
  );
  const pending = useSyncExternalStore(subscribe, () => isSaving(cache, projectId));

  const save = useCallback(
    async (request: GitWorkflowConnectionSave, token?: string): Promise<GitWorkflowConnectionResult> => {
      const generation = getSessionGeneration(cache);
      const key = slot(cache, request.projectId);
      track(cache, key, 1);
      try {
        const status = await latestConfirmedStatus(client, request.projectId);
        // Another account signed in meanwhile: this account's request is not sent.
        if (getSessionGeneration(cache) !== generation) throw new Error(FAILED);
        let result: GitWorkflowConnectionResult;
        try {
          result = await mutateData<GitWorkflowConnectionResult>(
            await api.app.projects[':projectId'].git.connection.$put({
              param: { projectId: request.projectId },
              json: gitWorkflowConnectionPayload(request.values, status, token),
            }),
            FAILED,
          );
        } catch (error) {
          throw sanitized(error);
        }
        await client.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail(request.projectId) });
        return result;
      } finally {
        track(cache, key, -1);
      }
    },
    [cache, client],
  );

  return { save, pending, isPending: () => isSaving(cache, projectId) };
}
