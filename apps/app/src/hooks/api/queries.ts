import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getData } from './client-helpers';
import { queryKeys } from './query-keys';
import type {
  AnalyticsOverview,
  ApiKey,
  Asset,
  ChangelogEntry,
  Comment,
  Deployment,
  Domain,
  Language,
  Member,
  Invitation,
  Page,
  PageNode,
  Project,
  SearchHit,
  SiteShell,
  SitePage,
  WorkspaceAnalytics,
  WorkspaceSettings,
} from './types';

export const useProjects = () =>
  useQuery({
    queryKey: queryKeys.projects.all(),
    queryFn: async () => getData<Project[]>(await api.api.app.projects.$get(), 'documentation sites'),
  });

export const useProject = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.projects.detail(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => getData<Project>(await api.api.app.projects[':id'].$get({ param: { id: projectId! } }), 'project'),
  });

export const usePages = (projectId: string | undefined, languageId?: string) =>
  useQuery({
    queryKey: queryKeys.pages.all(projectId ?? '', languageId),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<PageNode[]>(
        await api.api.app.projects[':projectId'].pages.$get({ param: { projectId: projectId! }, query: languageId ? { languageId } : {} }),
        'pages',
      ),
  });

export const useLanguages = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.languages.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => getData<Language[]>(await api.api.app.projects[':projectId'].languages.$get({ param: { projectId: projectId! } }), 'languages'),
  });

export const usePage = (projectId: string | undefined, pageId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.pages.detail(projectId ?? '', pageId ?? ''),
    enabled: Boolean(projectId && pageId),
    queryFn: async () =>
      getData<Page>(await api.api.app.projects[':projectId'].pages[':id'].$get({ param: { projectId: projectId!, id: pageId! } }), 'page'),
  });

// Publishing is async (worker builds the snapshot). Poll while a deployment is
// in flight so the dashboard transitions PENDING/BUILDING → READY/FAILED on its
// own instead of appearing stuck until a manual refresh.
const isInFlight = (status?: string): boolean => status === 'PENDING' || status === 'BUILDING';

export const useDeployments = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.deployments.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<Deployment[]>(await api.api.app.projects[':projectId'].deployments.$get({ param: { projectId: projectId! } }), 'deployments'),
    refetchInterval: (query) => (query.state.data?.some((d) => isInFlight(d.status)) ? 2500 : false),
  });

export const useLatestDeployment = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.deployments.latest(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<Deployment | null>(await api.api.app.projects[':projectId'].deployments.latest.$get({ param: { projectId: projectId! } }), 'deployment'),
    refetchInterval: (query) => (isInFlight(query.state.data?.status) ? 2500 : false),
  });

export const useDomains = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.domains.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => getData<Domain[]>(await api.api.app.projects[':projectId'].domains.$get({ param: { projectId: projectId! } }), 'domains'),
  });

export const useApiKeys = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.apiKeys.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => getData<ApiKey[]>(await api.api.app.projects[':projectId']['api-keys'].$get({ param: { projectId: projectId! } }), 'API keys'),
  });

export const useAssets = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.assets.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => getData<Asset[]>(await api.api.app.projects[':projectId'].assets.$get({ param: { projectId: projectId! } }), 'assets'),
  });

export const useAnalytics = (projectId: string | undefined, range: string) =>
  useQuery({
    queryKey: queryKeys.analytics.overview(projectId ?? '', range),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<AnalyticsOverview>(
        await api.api.app.projects[':projectId'].analytics.$get({ param: { projectId: projectId! }, query: { range: range as '24h' | '7d' | '30d' | '90d' } }),
        'analytics',
      ),
  });

export const useComments = (projectId: string | undefined, pageId?: string) =>
  useQuery({
    queryKey: queryKeys.comments.all(projectId ?? '', pageId),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<Comment[]>(
        await api.api.app.projects[':projectId'].comments.$get({ param: { projectId: projectId! }, query: pageId ? { pageId } : {} }),
        'comments',
      ),
  });

export const useWorkspaceAnalytics = (range: string) =>
  useQuery({
    queryKey: queryKeys.workspace.analytics(range),
    queryFn: async () =>
      getData<WorkspaceAnalytics>(
        await api.api.app.workspace.analytics.$get({ query: { range: range as '24h' | '7d' | '30d' | '90d' } }),
        'workspace analytics',
      ),
  });

export const useWorkspaceSettings = () =>
  useQuery({
    queryKey: queryKeys.workspace.settings(),
    queryFn: async () => getData<WorkspaceSettings>(await api.api.app.workspace.$get(), 'workspace settings'),
  });

export const useMembers = () =>
  useQuery({
    queryKey: queryKeys.members.all(),
    queryFn: async () => getData<{ members: Member[]; invitations: Invitation[] }>(await api.api.app.members.$get(), 'members'),
  });

// ─── Public site (live preview) ─────────────────────────────────────────────

export const useSite = (id: string | undefined, lang?: string) =>
  useQuery({
    queryKey: queryKeys.site.shell(id ?? '', lang),
    enabled: Boolean(id),
    retry: false,
    queryFn: async () => getData<SiteShell>(await api.api.public.sites[':id'].$get({ param: { id: id! }, query: lang ? { lang } : {} }), 'site'),
  });

export const useSitePage = (id: string | undefined, path: string, lang?: string) =>
  useQuery({
    queryKey: queryKeys.site.page(id ?? '', path, lang),
    enabled: Boolean(id),
    retry: false,
    queryFn: async () =>
      getData<SitePage>(await api.api.public.sites[':id'].page.$get({ param: { id: id! }, query: lang ? { path, lang } : { path } }), 'page'),
  });

export const useSiteSearch = (id: string | undefined, q: string, lang?: string) =>
  useQuery({
    queryKey: queryKeys.site.search(id ?? '', q, lang),
    enabled: Boolean(id && q.trim()),
    queryFn: async () => {
      const data = await getData<{ hits: SearchHit[] }>(
        await api.api.public.sites[':id'].search.$get({ param: { id: id! }, query: lang ? { q, lang } : { q } }),
        'search',
      );
      return data.hits;
    },
  });

export const useSiteChangelog = (id: string | undefined) =>
  useQuery({
    queryKey: queryKeys.site.changelog(id ?? ''),
    enabled: Boolean(id),
    retry: false,
    queryFn: async () => getData<ChangelogEntry[]>(await api.api.public.sites[':id'].changelog.$get({ param: { id: id! } }), 'changelog'),
  });
