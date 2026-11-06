import { REQUEST_LOCALE_HEADER } from '@nibleaf/i18n/locales';
import { getLocale } from '@nibleaf/i18n/runtime';
import {
  type AiConversationListQuery,
  type AiConversationRange,
  aiContentGapsResultSchema,
  aiConversationDetailSchema,
  aiConversationListResultSchema,
  aiConversationSummarySchema,
} from '@nibleaf/validators';
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import { apiOrigin } from '@/services/api-origin';
import { getData } from './client-helpers';
import { queryKeys } from './query-keys';

/*
 * AI assistant dashboard queries. The factories are the single definition of
 * each query (see apps/app/DATA_LOADING.md); the route loader imports this
 * module lazily, so its schemas stay out of the main chunk public pages load.
 */

export function aiConversationsPath(projectId: string, suffix = '', query: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  return `/api/app/projects/${encodeURIComponent(projectId)}/ai-conversations${suffix}${params.size ? `?${params}` : ''}`;
}
async function request<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal, method = 'GET') {
  const response = await fetch(`${apiOrigin()}${path}`, {
    method,
    signal,
    credentials: 'include',
    headers: { [REQUEST_LOCALE_HEADER]: getLocale() },
  });
  return schema.parse(await getData<unknown>(response, 'AI conversations'));
}

export type AiConversationFilters = Omit<AiConversationListQuery, 'cursor' | 'limit'>;

/** Paged and filtered: earlier results stay on screen while the next ones load. */
export const aiConversationsQueryOptions = (projectId: string, filters: AiConversationFilters) =>
  infiniteQueryOptions({
    queryKey: queryKeys.aiConversations.list(projectId, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(aiConversationsPath(projectId, '', { ...filters, cursor: pageParam }), aiConversationListResultSchema, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const aiConversationSummaryQueryOptions = (projectId: string, range: AiConversationRange, language?: string) => {
  // Daily buckets follow the viewer's own calendar.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return queryOptions({
    queryKey: queryKeys.aiConversations.summary(projectId, range, language, timezone),
    queryFn: ({ signal }) => request(aiConversationsPath(projectId, '/summary', { range, language, timezone }), aiConversationSummarySchema, signal),
    placeholderData: keepPreviousData,
  });
};

export const aiContentGapsQueryOptions = (projectId: string, range: AiConversationRange, language?: string) =>
  queryOptions({
    queryKey: queryKeys.aiConversations.gaps(projectId, range, language),
    queryFn: ({ signal }) => request(aiConversationsPath(projectId, '/gaps', { range, language }), aiContentGapsResultSchema, signal),
    placeholderData: keepPreviousData,
  });

export const aiConversationQueryOptions = (projectId: string, conversation?: string) =>
  queryOptions({
    queryKey: queryKeys.aiConversations.detail(projectId, conversation ?? ''),
    // A deleted or expired conversation will not come back on retry.
    retry: false,
    queryFn: conversation
      ? ({ signal }) => request(aiConversationsPath(projectId, `/${encodeURIComponent(conversation)}`), aiConversationDetailSchema, signal)
      : skipToken,
  });

export const useAiConversations = (projectId: string, filters: AiConversationFilters, enabled = true) =>
  useInfiniteQuery({ ...aiConversationsQueryOptions(projectId, filters), enabled });
export const useAiConversationSummary = (projectId: string, range: AiConversationRange, language?: string) =>
  useQuery(aiConversationSummaryQueryOptions(projectId, range, language));
export const useAiContentGaps = (projectId: string, range: AiConversationRange, language?: string, enabled = true) =>
  useQuery({ ...aiContentGapsQueryOptions(projectId, range, language), enabled });
export const useAiConversation = (projectId: string, conversation?: string) => useQuery(aiConversationQueryOptions(projectId, conversation));

export function useDeleteAiConversation(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (conversation: string) =>
      request(aiConversationsPath(projectId, `/${encodeURIComponent(conversation)}`), z.object({ deleted: z.literal(true) }), undefined, 'DELETE'),
    onSuccess: async (_data, conversation) => {
      client.removeQueries({ queryKey: queryKeys.aiConversations.detail(projectId, conversation) });
      await client.invalidateQueries({ queryKey: queryKeys.aiConversations.all(projectId) });
    },
  });
}
