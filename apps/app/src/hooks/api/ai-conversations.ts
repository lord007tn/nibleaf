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
import { infiniteQueryOptions, keepPreviousData, type QueryClient, queryOptions, skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import type { AiDashboardSearch } from '@/components/ai-conversations/search';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { apiOrigin } from '@/services/api-origin';
import { getData } from './client-helpers';

/*
 * AI assistant dashboard queries. The factories are the single definition of
 * each query (see apps/app/DATA_LOADING.md); the route loader imports this
 * module lazily, so its schemas, keys and prefetch stay out of the main chunk
 * public pages load.
 */

/** Every key starts with `['ai-conversations', projectId]`, so `all` invalidates them. */
export const aiConversationKeys = {
  all: (projectId: string) => ['ai-conversations', projectId] as const,
  list: (projectId: string, filters: Record<string, string | undefined>) => ['ai-conversations', projectId, 'list', filters] as const,
  summary: (projectId: string, range: string, language: string | undefined, timezone: string) =>
    ['ai-conversations', projectId, 'summary', range, language ?? null, timezone] as const,
  gaps: (projectId: string, range: string, language?: string) => ['ai-conversations', projectId, 'gaps', range, language ?? null] as const,
  detail: (projectId: string, conversation: string) => ['ai-conversations', projectId, 'detail', conversation] as const,
};

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

/** The conversation list's filters, from the dashboard's address. */
export function conversationFilters(search: AiDashboardSearch): AiConversationFilters {
  return { range: search.range, language: search.language, rating: search.rating, status: search.status, q: search.q };
}

/** Paged and filtered: earlier results stay on screen while the next ones load. */
export const aiConversationsQueryOptions = (projectId: string, filters: AiConversationFilters) =>
  infiniteQueryOptions({
    queryKey: aiConversationKeys.list(projectId, filters),
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
    queryKey: aiConversationKeys.summary(projectId, range, language, timezone),
    queryFn: ({ signal }) => request(aiConversationsPath(projectId, '/summary', { range, language, timezone }), aiConversationSummarySchema, signal),
    placeholderData: keepPreviousData,
  });
};

export const aiContentGapsQueryOptions = (projectId: string, range: AiConversationRange, language?: string) =>
  queryOptions({
    queryKey: aiConversationKeys.gaps(projectId, range, language),
    queryFn: ({ signal }) => request(aiConversationsPath(projectId, '/gaps', { range, language }), aiContentGapsResultSchema, signal),
    placeholderData: keepPreviousData,
  });

export const aiConversationQueryOptions = (projectId: string, conversation?: string) =>
  queryOptions({
    queryKey: aiConversationKeys.detail(projectId, conversation ?? ''),
    // The client's default policy: a deleted or expired conversation (4xx) is
    // never retried, while a dropped connection or a 5xx is.
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
      client.removeQueries({ queryKey: aiConversationKeys.detail(projectId, conversation) });
      await client.invalidateQueries({ queryKey: aiConversationKeys.all(projectId) });
    },
  });
}

/** Starts the active tab's queries for the dashboard route loader, without
 * holding navigation: the dashboard renders its skeleton at once. */
export async function prefetchAiDashboard(queryClient: QueryClient, projectId: string, search: AiDashboardSearch) {
  prefetchRouteData(queryClient, aiConversationSummaryQueryOptions(projectId, search.range, search.language));
  if (search.tab === 'gaps') prefetchRouteData(queryClient, aiContentGapsQueryOptions(projectId, search.range, search.language));
  if (search.conversation) prefetchRouteData(queryClient, aiConversationQueryOptions(projectId, search.conversation));
  // prefetchInfiniteQuery never throws; a failure shows through the list's own query.
  if (search.tab === 'conversations') await queryClient.prefetchInfiniteQuery(aiConversationsQueryOptions(projectId, conversationFilters(search)));
}
