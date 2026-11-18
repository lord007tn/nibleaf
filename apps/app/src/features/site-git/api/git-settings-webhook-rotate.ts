import { type QueryClient, useQueryClient as useCacheClient } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { safeSettingsError } from '@/hooks/api/workspace-settings-response';
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
 * A direct, non-replayed request: the only secret-bearing answer is request-local until its owning panel consumes
 * it. Shared busy bookkeeping holds ownership tokens and listeners only, through the original site's readback.
 * The original site's metadata is still refreshed when a panel retires; the retired panel never receives the answer.
 */
export function useGitSettingsWebhookRotate(projectId: string) {
  const cache = useCacheClient();
  const client = useSessionQueryClient();
  const generation = useMemo(() => getSessionGeneration(cache), [cache]);
  const pending = useRotating(cache, generation, projectId);

  const rotate = useCallback(
    async (site: string, ownsAnswer: () => boolean = () => true): Promise<{ webhookSecret: string | null } | null> => {
      const current = () => getSessionGeneration(cache) === generation;
      if (!current() || isRotating(cache, generation, site)) return null;
      const release = startRotation(cache, generation, site);
      try {
        let webhookSecret: string | null = null;
        try {
          const response = await api.app.projects[':projectId'].settings.git['webhook-secret'].$post({ param: { projectId: site } });
          if (!current()) {
            void response.body?.cancel().catch(() => undefined);
            return null;
          }
          // Refusals are reconstructed below, before any caller can retain or report the server's body.
          if (!response.ok) await mutateData(response, FAILED);
          if (!current()) return null;
          if (ownsAnswer()) {
            const answer = await mutateData<{ webhookSecret?: unknown }>(response, FAILED);
            if (!current()) return null;
            if (ownsAnswer()) webhookSecret = typeof answer?.webhookSecret === 'string' ? answer.webhookSecret : null;
          } else {
            await response.body?.cancel().catch(() => undefined);
          }
        } catch (error) {
          if (!current()) return null;
          throw safeSettingsError(error, FAILED, CODES);
        }
        if (!current()) return null;
        // Rotation already succeeded. A failed metadata refetch must not lose the only one-time answer.
        await client.invalidateQueries({ queryKey: queryKeys.workspace.projectSettings(site), exact: true }).catch(() => undefined);
        return current() && ownsAnswer() ? { webhookSecret } : null;
      } finally {
        release();
      }
    },
    [cache, client, generation],
  );

  return { rotate, pending };
}
