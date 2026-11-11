import type { PageHistoryComparison, PageHistoryEntry, PageHistoryTrimmedFromTrash } from '@nibleaf/shared/page-history';
import type { PageHistorySelection } from '@nibleaf/validators';
import { infiniteQueryOptions, queryOptions, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';
import type { Page } from './types';

const pageHistoryKeys = {
  history: (projectId: string, pageId: string, source: string) => ['page-history', projectId, pageId, source] as const,
  historyComparison: (projectId: string, pageId: string, source: string | undefined, entryId: string | undefined, updatedAt: string) =>
    ['page-history-comparison', projectId, pageId, source, entryId, updatedAt] as const,
};

type Cursor = { before: string; beforeId: string } | undefined;
/** `trimmedFromTrash`: a Trash restore could not bring back all of the page's history (#492). */
type HistoryList = { entries: PageHistoryEntry[]; next: Cursor | null; trimmedFromTrash?: PageHistoryTrimmedFromTrash | null };

export const pageHistoryQueryOptions = (projectId: string, pageId: string, source: PageHistorySelection['source']) =>
  infiniteQueryOptions({
    queryKey: pageHistoryKeys.history(projectId, pageId, source),
    initialPageParam: undefined as Cursor,
    queryFn: async ({ pageParam }) =>
      getData<HistoryList>(
        await api.app.projects[':projectId'].pages[':id'].history.$get({
          param: { projectId, id: pageId },
          query: { source, ...pageParam },
        }),
        'page history',
      ),
    getNextPageParam: (last) => last.next ?? undefined,
  });

export const pageHistoryComparisonQueryOptions = (projectId: string, pageId: string, selection: PageHistorySelection | null, updatedAt: string) =>
  queryOptions({
    queryKey: pageHistoryKeys.historyComparison(projectId, pageId, selection?.source, selection?.entryId, updatedAt),
    queryFn: selection
      ? async () =>
          getData<PageHistoryComparison>(
            await api.app.projects[':projectId'].pages[':id'].history.compare.$get({
              param: { projectId, id: pageId },
              query: selection,
            }),
            'page history comparison',
          )
      : skipToken,
  });

export const restorePageHistory = async (projectId: string, pageId: string, selection: PageHistorySelection, expectedUpdatedAt: string) =>
  mutateData<Page>(
    await api.app.projects[':projectId'].pages[':id'].history.restore.$post({
      param: { projectId, id: pageId },
      json: { ...selection, expectedUpdatedAt },
    }),
    'Could not restore this page.',
  );
