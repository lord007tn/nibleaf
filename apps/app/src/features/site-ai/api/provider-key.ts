import type { MessageKey } from '@nibleaf/i18n';
import type { SaveWorkspaceAiConnectionBody, WorkspaceAiModelsBody } from '@nibleaf/validators';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionQueryClient } from '@/integrations/tanstack-query/session-cache';
import { getSessionGeneration } from '@/integrations/tanstack-query/session-generation';
import { api } from '@/services/api';

/** What a key check answers: the models the key can use. */
export type ProviderKeyModels = { models: ReadonlyArray<{ id: string }> };

type Translate = (key: MessageKey) => string;

const CHECK_FAILED = 'Could not verify the provider.';
const SAVE_FAILED = 'Could not save the provider.';

/**
 * The only server codes kept from a refusal: the ones that change what the
 * person is told. A refused key has its own message; every other case is
 * worded from the HTTP status (409 conflict, 429 rate limit, …).
 */
const KEPT_CODES = new Set(['integration:credentials_invalid']);

/** Read a refusal into what is safe to keep: the status, a recognized code and a numeric Retry-After. Never its message, body or details, which could echo the key. */
async function refusal(response: Response, fallback: string) {
  let code: string | undefined;
  try {
    const body: unknown = await response.json();
    const sent = (body as { error?: { code?: unknown } } | null)?.error?.code;
    code = typeof sent === 'string' && KEPT_CODES.has(sent) ? sent : undefined;
  } catch {
    // Not JSON: the status alone says what happened.
  }
  const status = Number.isInteger(response.status) && response.status >= 400 && response.status <= 599 ? response.status : 500;
  const retryAfter = response.headers.get('retry-after') ?? '';
  return new ApiResponseError(fallback, status, code, /^\d{1,6}$/.test(retryAfter) ? retryAfter : undefined);
}

/** A failure that never reached an answer, without whatever the thrown error carried. */
const unanswered = (error: unknown, fallback: string) => (error instanceof TypeError ? new TypeError(fallback) : new Error(fallback));

/** Thrown once the session a request belongs to has ended: nothing more is read, written or reported for it. */
export class ProviderKeyObsolete extends Error {
  constructor() {
    super('The session this request belongs to has ended.');
    this.name = 'ProviderKeyObsolete';
  }
}

/** A failed check or save, in plain words: a refused key and a change made elsewhere get their own message. */
export const providerKeyErrorMessage = (t: Translate, error: unknown) =>
  error instanceof ApiResponseError && error.code === 'integration:credentials_invalid'
    ? t('settings.smartAi.invalidKey')
    : friendlyErrorMessage(t, error, 'settings.smartAi.error', { 409: 'settings.smartAi.conflict' });

/**
 * A site's own provider key: the check (which lists its models) and the save.
 *
 * Direct requests, not TanStack mutations: the key is only in the request body,
 * never in a mutation's variables, error or options, a dehydration, or a
 * retained closure. Neither is retried, paused offline or replayed on
 * reconnect. A refusal rejects with only its status, a recognized code and
 * Retry-After (`refusal`).
 *
 * Both belong to the session this hook was mounted in: once it has ended (or
 * at any await on the way), they send, read and write nothing more and reject
 * with `ProviderKeyObsolete`. Each request's site is the one passed to it.
 *
 * - `check(projectId, body)`: a new key being tried is not stored. A check of
 *   the saved key (no `apiKey`) records what it learned on the server, so the
 *   site's AI status is read again once it settles, either way, and the call
 *   resolves after that read.
 * - `save(projectId, body)`: the site's drafting capability is read again,
 *   then the answer (the redacted status) replaces the site's AI status and
 *   the call resolves.
 */
export function useProviderKeyRequests() {
  const cache = useQueryClient();
  const client = useSessionQueryClient();
  const generation = useMemo(() => getSessionGeneration(cache), [cache]);

  const check = useCallback(
    async (projectId: string, body: WorkspaceAiModelsBody): Promise<ProviderKeyModels> => {
      const current = () => getSessionGeneration(cache) === generation;
      const savedKey = !body.apiKey;
      if (!current()) throw new ProviderKeyObsolete();
      let outcome: { models: ProviderKeyModels } | { error: Error };
      try {
        const response = await api.app.projects[':projectId'].settings.ai.models.$post({ param: { projectId }, json: body });
        if (!current()) throw new ProviderKeyObsolete();
        if (!response.ok) outcome = { error: await refusal(response, CHECK_FAILED) };
        else {
          const { data } = (await response.json()) as { data: ProviderKeyModels };
          outcome = { models: data };
        }
      } catch (error) {
        if (error instanceof ProviderKeyObsolete) throw error;
        outcome = { error: unanswered(error, CHECK_FAILED) };
      }
      if (!current()) throw new ProviderKeyObsolete();
      if (savedKey) await client.invalidateQueries({ queryKey: queryKeys.workspaceAi.detail(projectId) });
      if (!current()) throw new ProviderKeyObsolete();
      if ('error' in outcome) throw outcome.error;
      return outcome.models;
    },
    [cache, client, generation],
  );

  const save = useCallback(
    async (projectId: string, body: SaveWorkspaceAiConnectionBody): Promise<void> => {
      const current = () => getSessionGeneration(cache) === generation;
      if (!current()) throw new ProviderKeyObsolete();
      let data: unknown;
      try {
        const response = await api.app.projects[':projectId'].settings.ai.connection.$put({ param: { projectId }, json: body });
        if (!current()) throw new ProviderKeyObsolete();
        if (!response.ok) throw await refusal(response, SAVE_FAILED);
        ({ data } = (await response.json()) as { data: unknown });
      } catch (error) {
        if (error instanceof ProviderKeyObsolete || error instanceof ApiResponseError) throw error;
        throw unanswered(error, SAVE_FAILED);
      }
      if (!current()) throw new ProviderKeyObsolete();
      await client.invalidateQueries({ queryKey: queryKeys.workspaceAi.draftCapability(projectId) });
      if (!current()) throw new ProviderKeyObsolete();
      // Last, so the form (keyed by the saved revision) is replaced only once this save has answered.
      client.setQueryData(queryKeys.workspaceAi.detail(projectId), data);
    },
    [cache, client, generation],
  );

  return useMemo(() => ({ check, save }), [check, save]);
}
