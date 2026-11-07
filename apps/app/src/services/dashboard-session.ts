import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { dashboardSessionMatches, resetDashboardSession, syncDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { authClient } from './auth-client';

const signingOut = new WeakSet<QueryClient>();

export async function signOutDashboard(queryClient: QueryClient, leaveDashboard: () => Promise<void>) {
  signingOut.add(queryClient);
  try {
    const result = await authClient.signOut();
    if (result.error) throw new Error('Sign-out failed');
    // Unmount dashboard query observers before clearing, so they cannot refetch as signed out.
    try {
      await leaveDashboard();
    } finally {
      resetDashboardSession(queryClient);
    }
  } finally {
    signingOut.delete(queryClient);
  }
}

/** Hide the old subtree before clearing it on a live session-user change. */
export function useDashboardSessionBoundary(userId: string | null): boolean {
  const queryClient = useQueryClient();
  const [readyUser, setReadyUser] = useState(userId);
  const matches = dashboardSessionMatches(queryClient, userId);
  useEffect(() => {
    if (signingOut.has(queryClient)) return;
    syncDashboardSession(queryClient, userId);
    setReadyUser(userId);
  }, [queryClient, userId]);
  return matches && readyUser === userId;
}
