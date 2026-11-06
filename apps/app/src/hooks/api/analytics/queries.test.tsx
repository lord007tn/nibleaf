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
});
