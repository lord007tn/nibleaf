import { useQuery } from '@tanstack/react-query';
import { isDeploymentInFlight } from './deployment-cache';
import {
  apiKeysQueryOptions,
  branchesQueryOptions,
  commentsQueryOptions,
  deploymentsQueryOptions,
  domainsQueryOptions,
  languagesQueryOptions,
  membersQueryOptions,
  notificationsQueryOptions,
  openApiConfigurationQueryOptions,
  pageQueryOptions,
  pagesQueryOptions,
  pendingChangesQueryOptions,
  projectAddonsQueryOptions,
  projectMembersQueryOptions,
  projectQueryOptions,
  projectsQueryOptions,
  projectUsageQueryOptions,
  unreadNotificationCountQueryOptions,
  workspaceSettingsQueryOptions,
} from './query-options';

/*
 * Thin hooks over the query factories in ./query-options (see
 * apps/app/DATA_LOADING.md). Only per-screen options (polling, `enabled`) live here.
 */

/** `pollWhilePublishing`: re-read the list every few seconds while one of the sites is publishing. */
export const useProjects = (options?: { pollWhilePublishing?: boolean }) =>
  useQuery({
    ...projectsQueryOptions(),
    refetchInterval: options?.pollWhilePublishing ? (query) => (query.state.data?.some((project) => project.publishing) ? 2500 : false) : false,
  });

export const useProject = (projectId: string | undefined) => useQuery(projectQueryOptions(projectId));

export const useProjectAddons = (projectId: string) => useQuery(projectAddonsQueryOptions(projectId));

export const useApiKeys = (projectId: string | undefined) => useQuery(apiKeysQueryOptions(projectId));

export const usePages = (projectId: string | undefined, languageId?: string, branchId?: string) =>
  useQuery(pagesQueryOptions(projectId, languageId, branchId));

export const useLanguages = (projectId: string | undefined) => useQuery(languagesQueryOptions(projectId));

export const useBranches = (projectId: string | undefined) => useQuery(branchesQueryOptions(projectId));

export const usePage = (projectId: string | undefined, pageId: string | undefined) => useQuery(pageQueryOptions(projectId, pageId));

// Publishing is async (worker builds the snapshot). Poll while a deployment is
// in flight so the dashboard transitions PENDING/BUILDING → READY/FAILED on its
// own instead of appearing stuck until a manual refresh. The factory's fetch
// also checks whether a publish just went live, so published-state UI never
// trusts the pre-publish answer (see syncPublishReceipt).
export const useDeployments = (projectId: string | undefined, options?: { enabled?: boolean; pollIntervalMs?: number }) =>
  useQuery({
    ...deploymentsQueryOptions(projectId),
    enabled: options?.enabled ?? true,
    refetchInterval: (query) => (query.state.data?.some((d) => isDeploymentInFlight(d.status)) ? (options?.pollIntervalMs ?? 2500) : false),
  });

// What the next publish will change vs. the last deploy (Mintlify-style "show
// changes"). The factory keeps it always stale, so it refetches on every mount.
export const usePendingChanges = (projectId: string | undefined, options?: { enabled?: boolean }) =>
  useQuery({ ...pendingChangesQueryOptions(projectId), enabled: options?.enabled ?? true });

export const useDomains = (projectId: string | undefined) => useQuery(domainsQueryOptions(projectId));

export const useOpenApiConfiguration = (projectId: string | undefined) => useQuery(openApiConfigurationQueryOptions(projectId));

/** Per-site usage counters (content, team, publish activity, traffic, storage)
 *  rendered as plan-limit meters on the settings Usage tab. */
export const useProjectUsage = (projectId: string | undefined) => useQuery(projectUsageQueryOptions(projectId));

export const useComments = (projectId: string | undefined, pageId?: string) => useQuery(commentsQueryOptions(projectId, pageId));

/** Workspace/site operational settings. Pass a projectId to read the SITE's own
 *  org settings (each site is its own workspace); omit it for the account view. */
export const useWorkspaceSettings = (projectId?: string) => useQuery(workspaceSettingsQueryOptions(projectId));

export const useMembers = () => useQuery(membersQueryOptions());

/** Members + pending invitations for a single site (its own organization). */
export const useProjectMembers = (projectId: string | undefined) => useQuery(projectMembersQueryOptions(projectId));

// ─── Notifications (bell inbox) ──────────────────────────────────────────────

/** The first inbox page (newest 50). Pass `enabled: false` until the popover opens. */
export const useNotifications = (options?: { enabled?: boolean }) => useQuery({ ...notificationsQueryOptions(), enabled: options?.enabled ?? true });

/** Unread badge count for the header bell. Polls every 60s. */
export const useUnreadNotificationCount = () => useQuery({ ...unreadNotificationCountQueryOptions(), refetchInterval: 60_000 });
