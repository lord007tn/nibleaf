import { type QueryClient, useQueryClient as useCacheClient } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { ApiResponseError, mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionQueryClient } from '@/integrations/tanstack-query/session-cache';
import { getSessionGeneration } from '@/integrations/tanstack-query/session-generation';
import { api } from '@/services/api';

const FAILED = 'Could not rotate the webhook secret.';

/**
 * The rotations in flight, per query client, session and site: one token each, nothing else (no request, answer or
 * secret). Only the rotation that holds a slot frees it, so a later session's or press's slot is never cleared early.
 */
type Rotations = { owners: Map<string, object>; listeners: Set<() => void> };
const rotationsByClient = new WeakMap<QueryClient, Rotations>();
const rotationsOf = (client: QueryClient): Rotations => {
  let rotations = rotationsByClient.get(client);
  if (!rotations) {
    rotations = { owners: new Map(), listeners: new Set() };
    rotationsByClient.set(client, rotations);
  }
  return rotations;
};
const slot = (generation: number, projectId: string) => JSON.stringify([generation, projectId]);
const isRotating = (client: QueryClient, generation: number, projectId: string) => rotationsOf(client).owners.has(slot(generation, projectId));

function startRotation(client: QueryClient, generation: number, projectId: string) {
  const rotations = rotationsOf(client);
  const key = slot(generation, projectId);
  const owner = {};
  const notify = () => {
    for (const listener of rotations.listeners) listener();
  };
  rotations.owners.set(key, owner);
  notify();
  return () => {
    if (rotations.owners.get(key) !== owner) return;
    rotations.owners.delete(key);
    notify();
  };
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
 * The codes `POST /settings/git/webhook-secret` answers with: the session and admin-role guards, a missing project id,
 * a missing site, a locked organization, and the error handler's codes by status. Any other code is dropped.
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
 * Settings → Git → Deploy on push → Generate / Rotate: `POST /settings/git/webhook-secret` with no body, which stores
 * a new secret (admin only). The settings page shows the secret from its own settings read, so the answer's body is
 * never read: the secret in it is not decoded, returned or kept.
 *
 * A direct request, not a TanStack mutation: no mutation, option, variable, meta, cached closure or error in any cache
 * holds the request or its answer, and a refusal comes back sanitized. Never retried, paused or replayed: a rotation
 * whose answer was lost may have stored a secret, so only a new press sends another; offline, it fails.
 *
 * `rotate(site)` sends once for `site`. On success it re-reads that site's settings, whatever the page shows by then,
 * and resolves to true after that read. It resolves to false, sending, re-reading or reporting nothing (more), while a
 * rotation of the site is in flight in this session (checked in the same tick as the send, so presses in one tick send
 * once), or once the session this hook was mounted in has ended (AppGuard remounts the dashboard for the next one).
 *
 * `pending` says whether a rotation of `projectId` is in flight from any instance in this session, until the request
 * and the re-read after a success end.
 */
export function useGitSettingsWebhookRotate(projectId: string) {
  const cache = useCacheClient();
  const client = useSessionQueryClient();
  const generation = useMemo(() => getSessionGeneration(cache), [cache]);
  const pending = useRotating(cache, generation, projectId);

  const rotate = useCallback(
    async (site: string): Promise<boolean> => {
      const current = () => getSessionGeneration(cache) === generation;
      if (!current() || isRotating(cache, generation, site)) return false;
      const release = startRotation(cache, generation, site);
      try {
        try {
          const response = await api.app.projects[':projectId'].settings.git['webhook-secret'].$post({ param: { projectId: site } });
          // A refusal throws the route's error, sanitized below; an answer's body (the secret) is dropped unread.
          if (!response.ok) await mutateData(response, FAILED);
          await response.body?.cancel().catch(() => undefined);
        } catch (error) {
          if (!current()) return false;
          throw sanitized(error);
        }
        if (!current()) return false;
        await client.invalidateQueries({ queryKey: queryKeys.workspace.projectSettings(site) });
        return current();
      } finally {
        release();
      }
    },
    [cache, client, generation],
  );

  return { rotate, pending };
}
