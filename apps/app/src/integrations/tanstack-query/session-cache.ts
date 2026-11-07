import { CancelledError, type DefaultError, type QueryClient, type UseMutationOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getSessionGeneration, type SessionCache, sessionOf } from './session-generation';

function clearDashboardData(queryClient: QueryClient, session: SessionCache) {
  // Revoke old callbacks' cache access before cancellation can settle a read.
  session.generation += 1;
  session.client = undefined;
  queryClient.clear();
  if (typeof window === 'undefined') return;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (
        key === 'nibleaf.activeProjectId' ||
        key.startsWith('nibleaf.publishNudge.') ||
        key.startsWith('nibleaf.startHere.dismissed.') ||
        key.startsWith('nibleaf:site-search:recent:')
      ) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage may be blocked; in-memory account data is still cleared.
  }
  try {
    window.sessionStorage.removeItem('nibleaf.chat.session');
  } catch {
    // Session storage may be blocked independently of local storage.
  }
}

export function resetDashboardSession(queryClient: QueryClient) {
  const session = sessionOf(queryClient);
  clearDashboardData(queryClient, session);
  session.userId = null;
}

/** Bind cache identity before dashboard loaders can reuse cached data. */
export function syncDashboardSession(queryClient: QueryClient, userId: string | null) {
  const session = sessionOf(queryClient);
  if (session.userId !== undefined && session.userId !== userId) clearDashboardData(queryClient, session);
  session.userId = userId;
}

export function dashboardSessionMatches(queryClient: QueryClient, userId: string | null) {
  const session = sessionOf(queryClient);
  return session.userId === undefined || session.userId === userId;
}

const asyncCacheWrites = new Set(['cancelQueries', 'invalidateQueries', 'refetchQueries', 'resetQueries']);
const syncCacheWrites = new Set(['setQueryData', 'setQueriesData', 'removeQueries', 'clear']);

/** Mutations keep the cache access they started with, even across awaits.
 * Reads/method receivers use the real client; stale writes and rollbacks are ignored.
 * This also covers a pending optimistic onMutate that resumes after a session change.
 * Dashboard consumers must stay under AppGuard's user-keyed ProjectProvider:
 * /app remounts both session hooks when accounts change. Other consumers need
 * the same account-keyed lifetime. Pinning the generation prevents a retained
 * observer from relabelling old pending work as the new account's mutation.
 */
export function useSessionQueryClient(): QueryClient {
  const queryClient = useQueryClient();
  return useMemo(() => {
    const session = sessionOf(queryClient);
    if (!session.client) {
      const generation = session.generation;
      session.client = new Proxy(queryClient, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            if (generation !== session.generation && typeof property === 'string') {
              if (asyncCacheWrites.has(property)) return Promise.resolve();
              if (syncCacheWrites.has(property)) return property === 'setQueriesData' ? [] : undefined;
            }
            return Reflect.apply(value, target, args);
          };
        },
      });
    }
    return session.client;
  }, [queryClient]);
}

/** Old-session requests cannot start after an awaited optimistic step or retry.
 * Like useSessionQueryClient, dashboard consumers must remain in AppGuard's
 * account-keyed subtree so new-account work starts with freshly mounted hooks.
 */
export function useSessionMutation<TData = unknown, TError = DefaultError, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
) {
  const client = useQueryClient();
  const session = sessionOf(client);
  const generation = useMemo(() => getSessionGeneration(client), [client]);
  const current = () => generation === session.generation;
  const mutationFn = options.mutationFn;
  const onMutate = options.onMutate;
  return useMutation<TData, TError, TVariables, TContext>({
    ...options,
    meta: { ...options.meta, sessionGeneration: generation },
    mutationFn: mutationFn
      ? (variables, context) => {
          if (!current()) return Promise.reject(new CancelledError());
          return mutationFn(variables, context);
        }
      : undefined,
    onMutate: onMutate
      ? (...args) => {
          if (!current()) throw new CancelledError();
          return onMutate(...args);
        }
      : undefined,
    onSuccess: (...args) => (current() ? options.onSuccess?.(...args) : undefined),
    onError: (...args) => (current() ? options.onError?.(...args) : undefined),
    onSettled: (...args) => (current() ? options.onSettled?.(...args) : undefined),
  });
}
