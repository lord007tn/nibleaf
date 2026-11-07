import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { authClient } from './auth-client';

// Per router/client, including per-request clients during server rendering.
const sessionUsers = new WeakMap<QueryClient, string | null>();

function clearDashboardData(queryClient: QueryClient) {
  // clear() destroys queries (cancelling pending reads) and the mutation cache.
  queryClient.clear();
  if (typeof window === 'undefined') return;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (
        key === 'nibleaf.activeProjectId' ||
        key.startsWith('nibleaf.publishNudge.') ||
        key.startsWith('nibleaf.startHere.dismissed.') ||
        key.startsWith('nibleaf.editor.')
      ) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage may be blocked. In-memory account data is still cleared.
  }
}

export function resetDashboardSession(queryClient: QueryClient) {
  clearDashboardData(queryClient);
  sessionUsers.set(queryClient, null);
}

/** Called before dashboard loaders can reuse another account's cached data. */
export function syncDashboardSession(queryClient: QueryClient, userId: string | null) {
  if (sessionUsers.has(queryClient) && sessionUsers.get(queryClient) !== userId) clearDashboardData(queryClient);
  sessionUsers.set(queryClient, userId);
}

export async function signOutDashboard(queryClient: QueryClient) {
  const result = await authClient.signOut();
  if (result.error) throw new Error('Sign-out failed');
  resetDashboardSession(queryClient);
}

/** Hide the old subtree before clearing it on a live session-user change. */
export function useDashboardSessionBoundary(userId: string | null): boolean {
  const queryClient = useQueryClient();
  const [readyUser, setReadyUser] = useState(userId);
  const matches = !sessionUsers.has(queryClient) || sessionUsers.get(queryClient) === userId;
  useEffect(() => {
    syncDashboardSession(queryClient, userId);
    setReadyUser(userId);
  }, [queryClient, userId]);
  return matches && readyUser === userId;
}
