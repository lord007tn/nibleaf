// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/services/api', () => {
  const never = { $get: () => new Promise(() => undefined) };
  return { api: { app: { projects: { ':projectId': { analytics: never } }, workspace: { analytics: never } } } };
});

import { queryKeys } from '../query-keys';
import { useProjectAnalytics, useWorkspaceAnalytics } from './queries';
import { analyticsTimezone, projectAnalyticsQueryOptions, workspaceAnalyticsQueryOptions } from './query-options';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const mount = async (Component: () => null) => {
  const queryClient = new QueryClient();
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Component />
      </QueryClientProvider>,
    ),
  );
  return { queryClient, unmount: () => act(async () => root.unmount()) };
};

describe('analytics overview queries', () => {
  it('key both factories with the central queryKeys', () => {
    expect(projectAnalyticsQueryOptions('p1', '30d', 'UTC').queryKey).toEqual(queryKeys.analytics.project('p1', '30d', 'UTC'));
    expect(workspaceAnalyticsQueryOptions('7d', 'UTC').queryKey).toEqual(queryKeys.analytics.workspace('7d', 'UTC'));
  });

  it('reads the entry a loader prefetches and reports project failures in plain language', async () => {
    const ProjectHome = () => {
      useProjectAnalytics('p1', '30d');
      return null;
    };
    const { queryClient, unmount } = await mount(ProjectHome);
    const query = queryClient.getQueryCache().find({ queryKey: projectAnalyticsQueryOptions('p1', '30d', analyticsTimezone()).queryKey });
    expect(query).toBeDefined();
    expect(query?.meta?.errorMessage).toBe('analytics.projectSummary.loadFailed');
    await unmount();
  });

  it('leaves workspace failures to the screens, which show their own retry', async () => {
    const WorkspaceHome = () => {
      useWorkspaceAnalytics('30d');
      return null;
    };
    const { queryClient, unmount } = await mount(WorkspaceHome);
    const query = queryClient.getQueryCache().find({ queryKey: workspaceAnalyticsQueryOptions('30d', analyticsTimezone()).queryKey });
    expect(query).toBeDefined();
    expect(query?.meta?.errorMessage).toBeUndefined();
    await unmount();
  });

  it('keeps the shown range on screen while a new range loads, so the chart never blanks or jumps (WORKSPACE-14)', async () => {
    let range: '30d' | '7d' = '30d';
    let seen: { data: unknown; isPending: boolean } | undefined;
    const ProjectHome = () => {
      const query = useProjectAnalytics('p1', range);
      seen = { data: query.data, isPending: query.isPending };
      return null;
    };
    const queryClient = new QueryClient();
    const shown = { timeseries: [{ date: '2026-11-01', views: 4 }] };
    queryClient.setQueryData(projectAnalyticsQueryOptions('p1', '30d', analyticsTimezone()).queryKey, shown as never);
    const container = document.createElement('div');
    const root = createRoot(container);
    const draw = () =>
      act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <ProjectHome />
          </QueryClientProvider>,
        ),
      );
    await draw();
    expect(seen?.data).toBe(shown);
    range = '7d';
    await draw();
    expect(seen).toEqual({ data: shown, isPending: false });
    await act(async () => root.unmount());
  });

  it('never shows the figures of another site while it loads', async () => {
    let projectId = 'p1';
    let seen: { data: unknown; isPending: boolean } | undefined;
    const ProjectHome = () => {
      const query = useProjectAnalytics(projectId, '30d');
      seen = { data: query.data, isPending: query.isPending };
      return null;
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(projectAnalyticsQueryOptions('p1', '30d', analyticsTimezone()).queryKey, { timeseries: [] } as never);
    const container = document.createElement('div');
    const root = createRoot(container);
    const draw = () =>
      act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <ProjectHome />
          </QueryClientProvider>,
        ),
      );
    await draw();
    projectId = 'p2';
    await draw();
    expect(seen).toEqual({ data: undefined, isPending: true });
    await act(async () => root.unmount());
  });
});
