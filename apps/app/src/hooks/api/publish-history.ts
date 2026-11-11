import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from './client-helpers';
import { isPublishInProgress, publishHistoryKey } from './deployment-cache';
import type { DeploymentStatus } from './types';

/** One publish attempt in the site's history (GET …/deployments/history). */
export interface PublishHistoryItem {
  id: string;
  version: number;
  status: DeploymentStatus;
  pagesCount: number;
  commitMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Null for an automatic publish or a deleted account. */
  publishedBy: string | null;
  /** The published copy is stored, so the version can be compared and restored. */
  snapshotAvailable: boolean;
}

export interface LiveVersion {
  id: string;
  version: number;
}

interface PublishHistoryPage {
  items: PublishHistoryItem[];
  nextCursor: number | null;
  live: LiveVersion | null;
}

export interface PublishChange {
  id: string;
  title: string;
  path: string;
  languageCode: string;
  kind: 'PAGE' | 'GROUP';
  status: 'added' | 'modified' | 'removed';
}

/** What a live version changed against the published version before it, computed
 *  and capped on the server (the snapshots themselves never reach the browser). */
export interface PublishChangeSummary {
  status: 'ready';
  previous: LiveVersion | null;
  totals: { added: number; modified: number; removed: number };
  changes: PublishChange[];
  truncated: boolean;
  settingsChanged: boolean;
}

/** A live-able version whose changes can't be shown: too large to compare in
 *  time, or its published copy is no longer stored. */
interface PublishSummaryUnavailable {
  status: 'unavailable';
  reason: 'too_large' | 'no_snapshot';
}

export interface PublishHistoryDetail {
  deployment: PublishHistoryItem & { error: string | null; errorDetails: unknown };
  live: LiveVersion | null;
  summary: PublishChangeSummary | PublishSummaryUnavailable | null;
}

/** While an attempt is queued, building or waiting for an automatic retry, re-read until it settles. */
const POLL_MS = 3000;

export const publishHistoryQueryOptions = (projectId: string) =>
  infiniteQueryOptions({
    queryKey: publishHistoryKey(projectId),
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) =>
      getData<PublishHistoryPage>(
        await api.app.projects[':projectId'].deployments.history.$get({
          param: { projectId },
          query: pageParam ? { cursor: String(pageParam) } : {},
        }),
        'publish history',
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (query) => (query.state.data?.pages.some((page) => page.items.some((item) => isPublishInProgress(item))) ? POLL_MS : false),
  });

export const publishHistoryDetailQueryOptions = (projectId: string, deploymentId: string) =>
  queryOptions({
    queryKey: [...publishHistoryKey(projectId), 'detail', deploymentId] as const,
    queryFn: async () =>
      getData<PublishHistoryDetail>(
        await api.app.projects[':projectId'].deployments.history[':id'].$get({ param: { projectId, id: deploymentId } }),
        'publish',
      ),
    refetchInterval: (query) => (isPublishInProgress(query.state.data?.deployment) ? POLL_MS : false),
  });

export const usePublishHistory = (projectId: string) => useInfiniteQuery(publishHistoryQueryOptions(projectId));

export const usePublishHistoryDetail = (projectId: string, deploymentId: string) =>
  useQuery(publishHistoryDetailQueryOptions(projectId, deploymentId));
