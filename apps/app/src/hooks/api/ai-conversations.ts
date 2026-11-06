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
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiOrigin } from '@/services/api-origin';
import { getData } from './client-helpers';

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
const key = (id: string) => ['ai-conversations', id] as const;
export function useAiConversations(id: string, filters: Omit<AiConversationListQuery, 'cursor' | 'limit'>, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...key(id), 'list', filters],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(aiConversationsPath(id, '', { ...filters, cursor: pageParam }), aiConversationListResultSchema, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
export function useAiConversationSummary(id: string, range: AiConversationRange, language?: string) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return useQuery({
    queryKey: [...key(id), 'summary', range, language, timezone],
    queryFn: ({ signal }) => request(aiConversationsPath(id, '/summary', { range, language, timezone }), aiConversationSummarySchema, signal),
  });
}
export function useAiContentGaps(id: string, range: AiConversationRange, language?: string, enabled = true) {
  return useQuery({
    queryKey: [...key(id), 'gaps', range, language],
    enabled,
    queryFn: ({ signal }) => request(aiConversationsPath(id, '/gaps', { range, language }), aiContentGapsResultSchema, signal),
  });
}
export function useAiConversation(id: string, conversation?: string) {
  return useQuery({
    queryKey: [...key(id), 'detail', conversation],
    enabled: Boolean(conversation),
    retry: false,
    queryFn: ({ signal }) => request(aiConversationsPath(id, `/${encodeURIComponent(conversation ?? '')}`), aiConversationDetailSchema, signal),
  });
}
export function useDeleteAiConversation(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (conversation: string) =>
      request(aiConversationsPath(id, `/${encodeURIComponent(conversation)}`), z.object({ deleted: z.literal(true) }), undefined, 'DELETE'),
    onSuccess: async (_data, conversation) => {
      client.removeQueries({ queryKey: [...key(id), 'detail', conversation] });
      await client.invalidateQueries({ queryKey: key(id) });
    },
  });
}
