import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getData } from './client-helpers';
import { queryKeys } from './query-keys';
import type {
  AnalyticsOverview,
  ApiKey,
  Asset,
  Branch,
  ChangelogEntry,
  Comment,
  Deployment,
  DeploymentDiff,
  Domain,
  Invitation,
  Language,
  Member,
  Page,
  PageNode,
  PendingChanges,
  Project,
  SearchHit,
  SitePage,
  SiteShell,
  WorkspaceAnalytics,
  WorkspaceSettings,
} from './types';

export const useProjects = () =>
  useQuery({
    queryKey: queryKeys.projects.all(),
    queryFn: async () => getData<Project[]>(await api.app.projects.$get(), 'documentation sites'),
  });

export const useProject = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.projects.detail(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => getData<Project>(await api.app.projects[':id'].$get({ param: { id: projectId! } }), 'project'),
  });

export const usePages = (projectId: string | undefined, languageId?: string, branchId?: string) =>
  useQuery({
    queryKey: queryKeys.pages.all(projectId ?? '', languageId, branchId),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<PageNode[]>(
        await api.app.projects[':projectId'].pages.$get({
          param: { projectId: projectId! },
          query: { ...(languageId ? { languageId } : {}), ...(branchId ? { branchId } : {}) },
        }),
        'pages',
      ),
  });

export const useLanguages = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.languages.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => getData<Language[]>(await api.app.projects[':projectId'].languages.$get({ param: { projectId: projectId! } }), 'languages'),
  });

export const useBranches = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.branches.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => getData<Branch[]>(await api.app.projects[':projectId'].branches.$get({ param: { projectId: projectId! } }), 'branches'),
  });

export const usePage = (projectId: string | undefined, pageId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.pages.detail(projectId ?? '', pageId ?? ''),
    enabled: Boolean(projectId && pageId),
    queryFn: async () =>
      getData<Page>(await api.app.projects[':projectId'].pages[':id'].$get({ param: { projectId: projectId!, id: pageId! } }), 'page'),
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
      getData<Deployment[]>(await api.app.projects[':projectId'].deployments.$get({ param: { projectId: projectId! } }), 'deployments'),
    refetchInterval: (query) => (query.state.data?.some((d) => isInFlight(d.status)) ? 2500 : false),
  });

export const useLatestDeployment = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.deployments.latest(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<Deployment | null>(await api.app.projects[':projectId'].deployments.latest.$get({ param: { projectId: projectId! } }), 'deployment'),
    refetchInterval: (query) => (isInFlight(query.state.data?.status) ? 2500 : false),
  });

// What the next publish will change vs. the last deploy (Mintlify-style "show
// changes"). Cheap to recompute, and the editor autosaves constantly, so keep it
// fresh: refetch on mount/focus rather than trusting the default staleTime.
export const usePendingChanges = (projectId: string | undefined, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: queryKeys.deployments.changes(projectId ?? ''),
    enabled: Boolean(projectId) && (options?.enabled ?? true),
    staleTime: 0,
    queryFn: async () =>
      getData<PendingChanges>(await api.app.projects[':projectId'].deployments.changes.$get({ param: { projectId: projectId! } }), 'changes'),
  });

export const useDeploymentDiff = (projectId: string | undefined, deploymentId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.deployments.diff(projectId ?? '', deploymentId ?? ''),
    enabled: Boolean(projectId && deploymentId),
    queryFn: async () =>
      getData<DeploymentDiff>(
        await api.app.projects[':projectId'].deployments[':id'].diff.$get({ param: { projectId: projectId!, id: deploymentId! } }),
        'deployment diff',
      ),
  });

export const useDomains = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.domains.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => getData<Domain[]>(await api.app.projects[':projectId'].domains.$get({ param: { projectId: projectId! } }), 'domains'),
  });

export const useApiKeys = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.apiKeys.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => getData<ApiKey[]>(await api.app.projects[':projectId']['api-keys'].$get({ param: { projectId: projectId! } }), 'API keys'),
  });

export const useAssets = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.assets.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => getData<Asset[]>(await api.app.projects[':projectId'].assets.$get({ param: { projectId: projectId! } }), 'assets'),
  });

export const useAnalytics = (projectId: string | undefined, range: string) =>
  useQuery({
    queryKey: queryKeys.analytics.overview(projectId ?? '', range),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<AnalyticsOverview>(
        await api.app.projects[':projectId'].analytics.$get({
          param: { projectId: projectId! },
          query: { range: range as '24h' | '7d' | '30d' | '90d' },
        }),
        'analytics',
      ),
  });

export const useComments = (projectId: string | undefined, pageId?: string) =>
  useQuery({
    queryKey: queryKeys.comments.all(projectId ?? '', pageId),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<Comment[]>(
        await api.app.projects[':projectId'].comments.$get({ param: { projectId: projectId! }, query: pageId ? { pageId } : {} }),
        'comments',
      ),
  });

export const useWorkspaceAnalytics = (range: string) =>
  useQuery({
    queryKey: queryKeys.workspace.analytics(range),
    queryFn: async () =>
      getData<WorkspaceAnalytics>(
        await api.app.workspace.analytics.$get({ query: { range: range as '24h' | '7d' | '30d' | '90d' } }),
        'workspace analytics',
      ),
  });

/** Workspace/site operational settings. Pass a projectId to read the SITE's own
 *  org settings (each site is its own workspace); omit it for the account view. */
export const useWorkspaceSettings = (projectId?: string) =>
  useQuery({
    queryKey: projectId ? queryKeys.workspace.projectSettings(projectId) : queryKeys.workspace.settings(),
    queryFn: async () =>
      projectId
        ? getData<WorkspaceSettings>(await api.app.projects[':projectId'].settings.$get({ param: { projectId } }), 'site settings')
        : getData<WorkspaceSettings>(await api.app.workspace.$get(), 'workspace settings'),
  });

export const useMembers = () =>
  useQuery({
    queryKey: queryKeys.members.all(),
    queryFn: async () => getData<{ members: Member[]; invitations: Invitation[] }>(await api.app.members.$get(), 'members'),
  });

/** Members + pending invitations for a single site (its own organization). */
export const useProjectMembers = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.members.forProject(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<{ members: Member[]; invitations: Invitation[] }>(
        await api.app.projects[':projectId'].members.$get({ param: { projectId: projectId! } }),
        'members',
      ),
  });

// ─── Public site (live preview) ─────────────────────────────────────────────

const siteQuery = (lang?: string, version?: string) => ({ ...(lang ? { lang } : {}), ...(version ? { version } : {}) });

export const useSite = (id: string | undefined, lang?: string, initialData?: SiteShell, version?: string) =>
  useQuery({
    queryKey: queryKeys.site.shell(id ?? '', lang, version),
    enabled: Boolean(id),
    retry: false,
    initialData,
    queryFn: async () => getData<SiteShell>(await api.public.sites[':id'].$get({ param: { id: id! }, query: siteQuery(lang, version) }), 'site'),
  });

export const useSitePage = (id: string | undefined, path: string, lang?: string, initialData?: SitePage, version?: string) =>
  useQuery({
    queryKey: queryKeys.site.page(id ?? '', path, lang, version),
    enabled: Boolean(id),
    retry: false,
    initialData,
    queryFn: async () =>
      getData<SitePage>(await api.public.sites[':id'].page.$get({ param: { id: id! }, query: { path, ...siteQuery(lang, version) } }), 'page'),
  });

export const useSiteSearch = (id: string | undefined, q: string, lang?: string, version?: string, limit?: number) =>
  useQuery({
    queryKey: queryKeys.site.search(id ?? '', q, lang, version, limit),
    enabled: Boolean(id && q.trim()),
    queryFn: async () => {
      const data = await getData<{ hits: SearchHit[] }>(
        await api.public.sites[':id'].search.$get({
          param: { id: id! },
          query: { q, ...(limit ? { limit: String(limit) } : {}), ...siteQuery(lang, version) },
        }),
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
    queryFn: async () => getData<ChangelogEntry[]>(await api.public.sites[':id'].changelog.$get({ param: { id: id! } }), 'changelog'),
  });
