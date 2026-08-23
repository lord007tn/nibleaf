import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from './client-helpers';
import { queryKeys } from './query-keys';
import type {
  Branch,
  Comment,
  Deployment,
  Domain,
  Language,
  NotificationList,
  OpenApiConfiguration,
  Page,
  PageNode,
  Project,
  WorkspaceSettings,
} from './types';

const requireQueryValue = (value: string | undefined, label: string) => {
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
};

export const useProjects = () =>
  useQuery({
    queryKey: queryKeys.projects.all(),
    queryFn: async () => getData<Project[]>(await api.app.projects.$get(), 'documentation sites'),
  });

export const useProject = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.projects.detail(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<Project>(await api.app.projects[':id'].$get({ param: { id: requireQueryValue(projectId, 'Project ID') } }), 'project'),
  });

export const usePages = (projectId: string | undefined, languageId?: string, branchId?: string) =>
  useQuery({
    queryKey: queryKeys.pages.all(projectId ?? '', languageId, branchId),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<PageNode[]>(
        await api.app.projects[':projectId'].pages.$get({
          param: { projectId: requireQueryValue(projectId, 'Project ID') },
          query: { ...(languageId ? { languageId } : {}), ...(branchId ? { branchId } : {}) },
        }),
        'pages',
      ),
  });

export const useLanguages = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.languages.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<Language[]>(
        await api.app.projects[':projectId'].languages.$get({ param: { projectId: requireQueryValue(projectId, 'Project ID') } }),
        'languages',
      ),
  });

export const useBranches = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.branches.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<Branch[]>(
        await api.app.projects[':projectId'].branches.$get({ param: { projectId: requireQueryValue(projectId, 'Project ID') } }),
        'branches',
      ),
  });

export const usePage = (projectId: string | undefined, pageId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.pages.detail(projectId ?? '', pageId ?? ''),
    enabled: Boolean(projectId && pageId),
    queryFn: async () =>
      getData<Page>(
        await api.app.projects[':projectId'].pages[':id'].$get({
          param: { projectId: requireQueryValue(projectId, 'Project ID'), id: requireQueryValue(pageId, 'Page ID') },
        }),
        'page',
      ),
  });

// Publishing is async (worker builds the snapshot). Poll while a deployment is
// in flight so the dashboard transitions PENDING/BUILDING → READY/FAILED on its
// own instead of appearing stuck until a manual refresh.
const isInFlight = (status?: string): boolean => status === 'PENDING' || status === 'BUILDING';

export const useDeployments = (projectId: string | undefined, options?: { enabled?: boolean; pollIntervalMs?: number }) =>
  useQuery({
    queryKey: queryKeys.deployments.all(projectId ?? ''),
    enabled: Boolean(projectId) && (options?.enabled ?? true),
    queryFn: async () =>
      getData<Deployment[]>(
        await api.app.projects[':projectId'].deployments.$get({ param: { projectId: requireQueryValue(projectId, 'Project ID') } }),
        'deployments',
      ),
    refetchInterval: (query) => (query.state.data?.some((d) => isInFlight(d.status)) ? (options?.pollIntervalMs ?? 2500) : false),
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
      getData(
        await api.app.projects[':projectId'].deployments.changes.$get({ param: { projectId: requireQueryValue(projectId, 'Project ID') } }),
        'changes',
      ),
  });

export const useDomains = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.domains.all(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<Domain[]>(
        await api.app.projects[':projectId'].domains.$get({ param: { projectId: requireQueryValue(projectId, 'Project ID') } }),
        'domains',
      ),
  });

export const useOpenApiConfiguration = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.openapi.detail(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<OpenApiConfiguration | null>(
        await api.app.projects[':projectId'].openapi.$get({ param: { projectId: requireQueryValue(projectId, 'Project ID') } }),
        'OpenAPI configuration',
      ),
  });

/** Per-site usage counters (content, team, publish activity, traffic, storage)
 *  rendered as plan-limit meters on the settings Usage tab. */
export const useProjectUsage = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.usage.forProject(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData(
        await api.app.projects[':projectId'].settings.usage.$get({ param: { projectId: requireQueryValue(projectId, 'Project ID') } }),
        'usage',
      ),
  });

export const useComments = (projectId: string | undefined, pageId?: string) =>
  useQuery({
    queryKey: queryKeys.comments.all(projectId ?? '', pageId),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData<Comment[]>(
        await api.app.projects[':projectId'].comments.$get({
          param: { projectId: requireQueryValue(projectId, 'Project ID') },
          query: pageId ? { pageId } : {},
        }),
        'comments',
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
    queryFn: async () => getData(await api.app.members.$get(), 'members'),
  });

/** Members + pending invitations for a single site (its own organization). */
export const useProjectMembers = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.members.forProject(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () =>
      getData(await api.app.projects[':projectId'].members.$get({ param: { projectId: requireQueryValue(projectId, 'Project ID') } }), 'members'),
  });

// ─── Notifications (bell inbox) ──────────────────────────────────────────────

/** The first inbox page (newest 50). Pass `enabled: false` until the popover opens. */
export const useNotifications = (options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: queryKeys.notifications.list(),
    enabled: options?.enabled ?? true,
    queryFn: async () => getData<NotificationList>(await api.app.notifications.$get({ query: {} }), 'notifications'),
  });

/** Unread badge count for the header bell. Polls every 60s. */
export const useUnreadNotificationCount = () =>
  useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    refetchInterval: 60_000,
    queryFn: async () => getData(await api.app.notifications['unread-count'].$get(), 'notifications'),
  });
