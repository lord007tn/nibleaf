// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { organizationKeys } from './organization-keys';
import type { PersonalPreferences } from './organization-query-options';
import { useLeaveOrganization, useUpdatePreferences } from './organizations';

const mocks = vi.hoisted(() => ({ putPreferences: vi.fn(), leave: vi.fn() }));

vi.mock('@/services/api', () => ({
  api: {
    app: {
      me: { preferences: { $put: mocks.putPreferences } },
      organizations: { ':organizationId': { leave: { $post: mocks.leave } } },
    },
  },
}));

const deferred = () => {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const failure = () => new Response(JSON.stringify({ error: { code: 'http:internal', message: 'boom' } }), { status: 500 });
const preferences = (memberJoined: boolean): PersonalPreferences => ({
  notifications: {
    member_joined: memberJoined,
    project_deploy: true,
    project_deploy_failed: true,
    project_new: true,
    security_login: true,
    workspace_plan: true,
    workspace_weekly: true,
  },
});
const alicePreferences = preferences(true);
const bobPreferences = preferences(false);

/** Merge council on #418: a late result from account A must never write into account B's cache. */
describe('organization mutations across an account switch', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let queryClient: QueryClient;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });
  const mount = async <T>(useHook: () => T) => {
    const ref: { current: T | null } = { current: null };
    function Probe() {
      ref.current = useHook();
      return null;
    }
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))));
    return ref;
  };

  it.each(['success', 'failure'])('keeps the new account’s preferences when the old account’s save ends in %s', async (outcome) => {
    syncDashboardSession(queryClient, 'alice');
    queryClient.setQueryData(organizationKeys.me.preferences(), alicePreferences);
    const response = deferred();
    mocks.putPreferences.mockReturnValue(response.promise);
    const update = await mount(() => useUpdatePreferences());
    let settled: Promise<unknown> = Promise.resolve();
    await act(async () => {
      settled = update.current?.mutateAsync({ member_joined: false }).catch((error: unknown) => error) ?? settled;
    });
    syncDashboardSession(queryClient, 'bob');
    queryClient.setQueryData(organizationKeys.me.preferences(), bobPreferences);
    await act(async () => {
      response.resolve(outcome === 'failure' ? failure() : new Response(JSON.stringify({ data: alicePreferences }), { status: 200 }));
      await settled;
    });
    // Neither alice's success data nor her rollback snapshot reaches bob's cache.
    expect(queryClient.getQueryData(organizationKeys.me.preferences())).toEqual(bobPreferences);
  });

  it('does not refresh the new account’s lists when the old account’s leave finishes late', async () => {
    syncDashboardSession(queryClient, 'alice');
    const response = deferred();
    mocks.leave.mockReturnValue(response.promise);
    const leave = await mount(() => useLeaveOrganization('org-a'));
    let settled: Promise<unknown> = Promise.resolve();
    await act(async () => {
      settled = leave.current?.mutateAsync().catch((error: unknown) => error) ?? settled;
    });
    syncDashboardSession(queryClient, 'bob');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      response.resolve(new Response(JSON.stringify({ data: { id: 'member-a' } }), { status: 200 }));
      await settled;
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
