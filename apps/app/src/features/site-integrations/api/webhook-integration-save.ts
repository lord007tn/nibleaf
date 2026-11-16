import type { IntegrationConnectionSummary, IntegrationProviderId } from '@nibleaf/shared/integrations';
import { randomUUID } from '@nibleaf/shared/uuid';
import type { CreateProjectIntegrationBody, UpdateProjectIntegrationBody } from '@nibleaf/validators';
import { type QueryClient, useQueryClient as useCacheClient } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { ApiResponseError, mutateData } from '@/hooks/api/client-helpers';
import { safeIntegrationError } from '@/hooks/api/integrations';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionQueryClient } from '@/integrations/tanstack-query/session-cache';
import { getSessionGeneration } from '@/integrations/tanstack-query/session-generation';
import { api } from '@/services/api';

export type WebhookProviderId = 'slack' | 'discord' | 'zapier';

/**
 * A Connect or Save as pressed: the site and provider it is for, the stored
 * revision it edits (null connects a new one) and the label as typed. The
 * webhook URL goes beside it, never in it.
 */
export type WebhookIntegrationSave = { projectId: string; providerId: WebhookProviderId; revision: number | null; label: string };

const FAILED = 'Integration request failed.';

/**
 * The sends in flight, per query client, session, site and provider: a count,
 * nothing else (no request, body or URL), so a panel opened again while its
 * send runs is busy too, and another account's never is.
 */
type Sending = { counts: Map<string, number>; listeners: Set<() => void> };
const sendingByClient = new WeakMap<QueryClient, Sending>();
const sendingOf = (client: QueryClient): Sending => {
  let sending = sendingByClient.get(client);
  if (!sending) {
    sending = { counts: new Map(), listeners: new Set() };
    sendingByClient.set(client, sending);
  }
  return sending;
};
const slot = (generation: number, projectId: string, providerId: string) => JSON.stringify([generation, projectId, providerId]);
const isSending = (client: QueryClient, key: string) => (sendingOf(client).counts.get(key) ?? 0) > 0;
const track = (client: QueryClient, key: string, change: 1 | -1) => {
  const { counts, listeners } = sendingOf(client);
  const count = (counts.get(key) ?? 0) + change;
  if (count > 0) counts.set(key, count);
  else counts.delete(key);
  for (const listener of listeners) listener();
};

/** The request a press makes, with a new idempotency key: Connect sends the URL; Save sends it only when one was typed. */
function request({ projectId, providerId, revision, label }: WebhookIntegrationSave, webhookUrl: string) {
  const idempotencyKey = randomUUID();
  if (revision === null) {
    const json: CreateProjectIntegrationBody = { providerId, webhookUrl, label: label.trim() || undefined, idempotencyKey };
    return api.app.projects[':projectId'].integrations.$post({ param: { projectId }, json });
  }
  const json: UpdateProjectIntegrationBody = {
    providerId,
    label: label.trim() || null,
    expectedRevision: revision,
    idempotencyKey,
    // Blank keeps the stored URL.
    ...(webhookUrl ? { webhookUrl, replaceCredential: true as const } : {}),
  };
  return api.app.projects[':projectId'].integrations[':providerId'].$patch({ param: { projectId, providerId }, json });
}

/**
 * Connects (Create) or saves (Edit) a Slack, Discord or Zapier webhook. Class:
 * form save, not optimistic. A direct request, not a mutation: the webhook URL
 * is sent only in its body, so no cache, mutation, option, meta or retained
 * closure holds it, and a failure comes back as `safeIntegrationError`.
 *
 * `send(save, webhookUrl)`:
 * - on success, refreshes the integrations of the site the request was for,
 *   whatever the page shows by then, and resolves after that refresh;
 * - on a revision conflict, rereads that site's integrations (the exact key,
 *   even if nothing shows them) before it rejects;
 * - is never retried, cancelled, paused or replayed; once the session this
 *   hook was mounted in has ended, it sends, reads and refreshes nothing more
 *   and resolves to null.
 *
 * `pending` and `isPending()` say whether a send for `projectId` and
 * `providerId` is in flight from any panel in this session: `pending` for
 * rendering, `isPending()` for a press, which reads it in the same tick.
 */
export function useWebhookIntegrationSave(projectId: string, providerId: IntegrationProviderId) {
  const cache = useCacheClient();
  const client = useSessionQueryClient();
  // AppGuard remounts dashboard hooks for another account: a send from an ended session does nothing.
  const generation = useMemo(() => getSessionGeneration(cache), [cache]);
  const key = slot(generation, projectId, providerId);
  const subscribe = useCallback(
    (listener: () => void) => {
      const { listeners } = sendingOf(cache);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [cache],
  );
  const pending = useSyncExternalStore(subscribe, () => isSending(cache, key));

  const send = useCallback(
    async (save: WebhookIntegrationSave, webhookUrl: string): Promise<IntegrationConnectionSummary | null> => {
      const current = () => getSessionGeneration(cache) === generation;
      if (!current()) return null;
      const sent = slot(generation, save.projectId, save.providerId);
      track(cache, sent, 1);
      try {
        const integrations = queryKeys.integrations.all(save.projectId);
        let result: IntegrationConnectionSummary;
        try {
          const response = await request(save, webhookUrl);
          if (!current()) return null;
          result = await mutateData<IntegrationConnectionSummary>(response, FAILED);
        } catch (error) {
          if (!current()) return null;
          // Someone else changed the connection: show its current revision.
          if (error instanceof ApiResponseError && error.code === 'integration:revision_conflict') {
            await client.invalidateQueries({ queryKey: integrations, exact: true, refetchType: 'all' });
            if (!current()) return null;
          }
          throw safeIntegrationError(error);
        }
        if (!current()) return null;
        await client.invalidateQueries({ queryKey: integrations });
        return current() ? result : null;
      } finally {
        track(cache, sent, -1);
      }
    },
    [cache, client, generation],
  );

  return { send, pending, isPending: () => isSending(cache, key) };
}
