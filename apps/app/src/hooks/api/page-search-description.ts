import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from './client-helpers';
import { queryKeys } from './query-keys';

/*
 * Dashboard-only (the page settings dialog), so it lives outside
 * `query-options.ts`, whose code ships with the public reader's main chunk.
 */

/** Under the page's detail key, so invalidating the page (every save) refreshes it too. */
export const pageSearchDescriptionKey = (projectId: string, pageId: string) =>
  [...queryKeys.pages.detail(projectId, pageId), 'search-description'] as const;

/** The description the published site generates from the page's saved content
 *  when the author writes none, with the page revision (`updatedAt`) it was
 *  generated from. Content autosaves while the editor is open, so every read
 *  refetches. */
const pageSearchDescriptionQueryOptions = (projectId: string | undefined, pageId: string | undefined) =>
  queryOptions({
    queryKey: pageSearchDescriptionKey(projectId ?? '', pageId ?? ''),
    staleTime: 0,
    queryFn:
      projectId && pageId
        ? async () =>
            getData<{ description: string; revision: string }>(
              await api.app.projects[':projectId'].pages[':id']['search-description'].$get({ param: { projectId, id: pageId } }),
              'search description',
            )
        : skipToken,
  });

export const usePageSearchDescription = (projectId: string | undefined, pageId: string | undefined, { enabled = true } = {}) =>
  useQuery({ ...pageSearchDescriptionQueryOptions(projectId, pageId), enabled });
