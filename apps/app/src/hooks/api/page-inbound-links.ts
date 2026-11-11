import { queryOptions, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from './client-helpers';
import { queryKeys } from './query-keys';

interface InboundPageLinks {
  pages: { id: string; title: string; path: string }[];
  total: number;
}

// Dashboard-only: parsing and route resolution stay on the server.
const pageInboundLinksQueryOptions = (projectId: string, pageId: string) =>
  queryOptions({
    queryKey: [...queryKeys.pages.detail(projectId, pageId), 'inbound-links'],
    // Recheck every dialog open: links in any other page may have changed.
    staleTime: 0,
    retry: false,
    queryFn: async () =>
      getData<InboundPageLinks>(
        await api.app.projects[':projectId'].pages[':id']['inbound-links'].$get({ param: { projectId, id: pageId } }),
        'inbound links',
      ),
  });

export const usePageInboundLinks = (projectId: string, pageId: string) => useQuery(pageInboundLinksQueryOptions(projectId, pageId));
