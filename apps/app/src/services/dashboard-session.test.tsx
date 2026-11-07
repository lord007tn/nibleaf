// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('./auth-client', () => ({ authClient: { signOut: auth.signOut } }));

import { resetDashboardSession, signOutDashboard, syncDashboardSession, useDashboardSessionBoundary } from './dashboard-session';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });

describe('dashboard session isolation', () => {
  it('retains same-user cache and clears query/mutation caches for a new user', () => {
    const queryClient = client();
    syncDashboardSession(queryClient, 'alice');
    queryClient.setQueryData(['projects'], ['Alice site']);
    queryClient.getMutationCache().build(queryClient, { mutationKey: ['private'] });
    syncDashboardSession(queryClient, 'alice');
    expect(queryClient.getQueryData(['projects'])).toEqual(['Alice site']);
    syncDashboardSession(queryClient, 'bob');
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('clears account dashboard selections while preserving unrelated preferences and reader consent', () => {
    const queryClient = client();
    for (const key of ['nibleaf.activeProjectId', 'nibleaf.publishNudge.site', 'nibleaf.startHere.dismissed.alice', 'nibleaf.editor.collapsedLangs'])
      localStorage.setItem(key, 'private');
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('nibleaf.analytics.consent.site', 'accepted');
    sessionStorage.setItem('unrelated', 'keep');
    resetDashboardSession(queryClient);
    expect(localStorage.getItem('nibleaf.activeProjectId')).toBeNull();
    expect(localStorage.getItem('nibleaf.publishNudge.site')).toBeNull();
    expect(localStorage.getItem('nibleaf.startHere.dismissed.alice')).toBeNull();
    expect(localStorage.getItem('nibleaf.editor.collapsedLangs')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem('nibleaf.analytics.consent.site')).toBe('accepted');
    expect(sessionStorage.getItem('unrelated')).toBe('keep');
  });

  it('prevents a previous-user request completing after reset from repopulating the cache', async () => {
    const queryClient = client();
    syncDashboardSession(queryClient, 'alice');
    let finish: (value: string[]) => void = () => undefined;
    const request = queryClient
      .fetchQuery({
        queryKey: ['projects'],
        queryFn: () =>
          new Promise<string[]>((resolve) => {
            finish = resolve;
          }),
      })
      .catch(() => undefined);
    syncDashboardSession(queryClient, 'bob');
    finish(['Alice site']);
    await request;
    expect(queryClient.getQueryData(['projects'])).toBeUndefined();
  });

  it('clears only after a successful sign-out and reports failure to the caller', async () => {
    const queryClient = client();
    syncDashboardSession(queryClient, 'alice');
    queryClient.setQueryData(['projects'], ['Alice site']);
    auth.signOut.mockResolvedValueOnce({ error: { message: 'unavailable' } });
    await expect(signOutDashboard(queryClient)).rejects.toThrow();
    expect(queryClient.getQueryData(['projects'])).toEqual(['Alice site']);
    auth.signOut.mockResolvedValueOnce({ error: null });
    await signOutDashboard(queryClient);
    expect(queryClient.getQueryData(['projects'])).toBeUndefined();
  });

  it('hides children before the new user can render old cached data and remounts with fresh data', async () => {
    const queryClient = client();
    syncDashboardSession(queryClient, 'alice');
    queryClient.setQueryData(['projects'], ['Alice site']);
    const rendered: string[] = [];
    function Sites() {
      const query = useQuery({ queryKey: ['projects'], queryFn: async () => ['Bob site'] });
      const value = query.data?.join(',') ?? 'loading';
      rendered.push(value);
      return <p>{value}</p>;
    }
    function Boundary({ userId, children }: { userId: string; children: ReactNode }) {
      return useDashboardSessionBoundary(userId) ? children : <p>switching</p>;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = (userId: string) =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Boundary userId={userId}>
            <Sites />
          </Boundary>
        </QueryClientProvider>,
      );
    try {
      await act(async () => render('alice'));
      rendered.length = 0;
      await act(async () => render('bob'));
      expect(rendered).not.toContain('Alice site');
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(host.textContent).toBe('Bob site');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
