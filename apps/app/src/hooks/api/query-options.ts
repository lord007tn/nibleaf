import { queryOptions, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from './client-helpers';
import { queryKeys } from './query-keys';
import type { ApiKeyList, Branch, ConnectedApp, Deployment, Language, PageNode, Project } from './types';

/*
 * Query factories (`queryOptions`) are the single definition of each query: its
 * key (always from `queryKeys`), fetcher and per-query options. Hooks wrap them
 * with `useQuery(factory(...))`, and route loaders prefetch the same factory, so
 * a loader and a component can never disagree about a key. See
 * apps/app/DATA_LOADING.md.
 *
 * Keep this module light: route loaders import it directly, and a loader's
 * imports ship with the route's main chunk, which public pages also load. No
 * i18n, mutations or components here.
 */

export const projectsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.projects.all(),
    queryFn: async () => getData<Project[]>(await api.app.projects.$get(), 'documentation sites'),
  });

export const projectQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.projects.detail(projectId ?? ''),
    queryFn: projectId ? async () => getData<Project>(await api.app.projects[':id'].$get({ param: { id: projectId } }), 'project') : skipToken,
  });

export const pagesQueryOptions = (projectId: string | undefined, languageId?: string, branchId?: string) =>
  queryOptions({
    queryKey: queryKeys.pages.all(projectId ?? '', languageId, branchId),
    queryFn: projectId
      ? async () =>
          getData<PageNode[]>(
            await api.app.projects[':projectId'].pages.$get({
              param: { projectId },
              query: { ...(languageId ? { languageId } : {}), ...(branchId ? { branchId } : {}) },
            }),
            'pages',
          )
      : skipToken,
  });

export const languagesQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.languages.all(projectId ?? ''),
    queryFn: projectId
      ? async () => getData<Language[]>(await api.app.projects[':projectId'].languages.$get({ param: { projectId } }), 'languages')
      : skipToken,
  });

export const branchesQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.branches.all(projectId ?? ''),
    queryFn: projectId
      ? async () => getData<Branch[]>(await api.app.projects[':projectId'].branches.$get({ param: { projectId } }), 'branches')
      : skipToken,
  });

export const deploymentsQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.deployments.all(projectId ?? ''),
    queryFn: projectId
      ? async () => getData<Deployment[]>(await api.app.projects[':projectId'].deployments.$get({ param: { projectId } }), 'deployments')
      : skipToken,
  });

/** Personal MCP keys (one's own; everyone's for admins) plus the instance's MCP settings. */
export const apiKeysQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.apiKeys.all(projectId ?? ''),
    queryFn: projectId
      ? async (): Promise<ApiKeyList> => {
          const response = await api.app.projects[':projectId']['api-keys'].$get({ param: { projectId } });
          // getData throws the readable error; the list needs `meta` too, so read the body here.
          if (!response.ok) await getData(response, 'AI assistant keys');
          return response.json();
        }
      : skipToken,
  });

/** AI apps connected by signing in (OAuth): one's own, or everyone's for admins. */
export const connectedAppsQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.connectedApps.all(projectId ?? ''),
    queryFn: projectId
      ? async () => getData<ConnectedApp[]>(await api.app.projects[':projectId']['connected-apps'].$get({ param: { projectId } }), 'connected apps')
      : skipToken,
  });
