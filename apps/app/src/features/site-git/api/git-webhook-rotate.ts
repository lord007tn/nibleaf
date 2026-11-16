import { type QueryClient, useQueryClient as useCacheClient } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { ApiResponseError, mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionQueryClient } from '@/integrations/tanstack-query/session-cache';
import { getSessionGeneration } from '@/integrations/tanstack-query/session-generation';
import { api } from '@/services/api';

/** A rotation's answer, for the panel that asked: the new webhook secret, shown once. */
export type GitWebhookRotation = { webhookSecret: string | null };

const FAILED = 'Could not rotate the webhook secret.';

/**
 * The rotations in flight, per query client, session and site: a count, nothing else (no request, answer or secret).
 * A rotation started before leaving and coming back to a site still makes it busy, and another account's never does.
 */
type Rotations = { counts: Map<string, number>; listeners: Set<() => void> };
const rotationsByClient = new WeakMap<QueryClient, Rotations>();
const rotationsOf = (client: QueryClient): Rotations => {
  let rotations = rotationsByClient.get(client);
  if (!rotations) {
    rotations = { counts: new Map(), listeners: new Set() };
    rotationsByClient.set(client, rotations);
  }
  return rotations;
};
const slot = (generation: number, projectId: string) => JSON.stringify([generation, projectId]);
const isRotating = (client: QueryClient, generation: number, projectId: string) =>
  (rotationsOf(client).counts.get(slot(generation, projectId)) ?? 0) > 0;

function startRotation(client: QueryClient, generation: number, projectId: string) {
  const key = slot(generation, projectId);
  const change = (by: 1 | -1) => {
    const { counts, listeners } = rotationsOf(client);
    const count = (counts.get(key) ?? 0) + by;
    if (count > 0) counts.set(key, count);
    else counts.delete(key);
    for (const listener of listeners) listener();
  };
  change(1);
  return () => change(-1);
}

/** No rotation is in flight while the server renders. */
const noServerRotation = () => false;

function useRotating(client: QueryClient, generation: number, projectId: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const { listeners } = rotationsOf(client);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [client],
  );
  return useSyncExternalStore(subscribe, () => isRotating(client, generation, projectId), noServerRotation);
}

/**
 * The codes `POST /git/webhook-secret` answers with: the session and admin-role guards, a missing project id, a
 * missing connection, a locked organization, and the error handler's codes by status. Any other code is dropped.
 */
const CODES = new Set([
  'auth:no_user',
  'auth:invalid_session',
  'auth:insufficient_role',
  'http:bad_request',
  'http:unauthorized',
  'http:forbidden',
  'http:not_found',
  'http:conflict',
  'http:rate_limited',
  'http:internal',
  'database:not_found',
  'database:conflict',
]);

/**
 * The error a refused rotation reports: the HTTP status, the code when it is one this route answers with, and a
 * numeric `Retry-After`. Never the server's message, details or anything else it sent.
 */
const sanitized = (error: unknown) => {
  if (error instanceof ApiResponseError) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    const code = error.code && CODES.has(error.code) ? error.code : undefined;
    const retryAfter = error.retryAfter && /^\d{1,6}$/.test(error.retryAfter) ? error.retryAfter : undefined;
    return new ApiResponseError(FAILED, status, code, retryAfter);
  }
  return error instanceof TypeError ? new TypeError(FAILED) : new Error(FAILED);
};

/**
 * Rotate webhook secret: `POST /git/webhook-secret` with no body, which stores a new secret and answers with it once.
 *
 * A direct request, not a TanStack mutation: the answer (and so the secret) is held only by this call and its caller.
 * No mutation, option, cached closure or error in any cache holds it, and a refusal comes back sanitized. Never
 * retried, paused or replayed: a rotation whose answer was lost may have stored a secret, so only a new press sends
 * another; offline, it fails.
 *
 * `rotate(site)` sends once for `site`. On success it refreshes that site's status, whatever the page shows by then,
 * and resolves after that read. It resolves to null, sending, refreshing or reporting nothing (more), while a rotation
 * of the site is in flight in this session (checked in the same tick as the send, so presses in one tick send once),
 * or once the session this hook was mounted in has ended (AppGuard remounts the dashboard for the next one).
 *
 * `pending` says whether a rotation of `projectId` is in flight from any instance in this session, until the request
 * and the refresh after a success end.
 */
export function useGitWebhookRotate(projectId: string) {
  const cache = useCacheClient();
  const client = useSessionQueryClient();
  const generation = useMemo(() => getSessionGeneration(cache), [cache]);
  const pending = useRotating(cache, generation, projectId);

  const rotate = useCallback(
    async (site: string): Promise<GitWebhookRotation | null> => {
      const current = () => getSessionGeneration(cache) === generation;
      if (!current() || isRotating(cache, generation, site)) return null;
      const release = startRotation(cache, generation, site);
      try {
        let webhookSecret: string | null;
        try {
          const answer = await mutateData<{ webhookSecret?: unknown }>(
            await api.app.projects[':projectId'].git['webhook-secret'].$post({ param: { projectId: site } }),
            FAILED,
          );
          webhookSecret = typeof answer?.webhookSecret === 'string' ? answer.webhookSecret : null;
        } catch (error) {
          if (!current()) return null;
          throw sanitized(error);
        }
        if (!current()) return null;
        await client.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail(site) });
        return current() ? { webhookSecret } : null;
      } finally {
        release();
      }
    },
    [cache, client, generation],
  );

  return { rotate, pending };
}
