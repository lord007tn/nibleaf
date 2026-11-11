import { useQuery } from '@tanstack/react-query';
import { isDeploymentInFlight } from './deployment-cache';
import {
  aiDraftCapabilityQueryOptions,
  apiKeysQueryOptions,
  branchesQueryOptions,
  commentsQueryOptions,
  deploymentsQueryOptions,
  domainsQueryOptions,
  languagesQueryOptions,
  liveDeploymentsQueryOptions,
  notificationsQueryOptions,
  openApiConfigurationQueryOptions,
  pageQueryOptions,
  pagesQueryOptions,
  pageTrashQueryOptions,
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

/** While `waiting` is set (a key was just created, rotated or tested), poll
 *  until that key is used after `since` (server time), so the page can say the
 *  AI app connected, but no longer than `until` (this computer's time). */
export const useApiKeys = (projectId: string | undefined, waiting?: { id: string; since: number; until: number } | null) =>
  useQuery({
    ...apiKeysQueryOptions(projectId),
    refetchInterval: (query) =>
      waiting &&
      Date.now() < waiting.until &&
      !query.state.data?.data.some((key) => key.id === waiting.id && key.lastUsedAt && Date.parse(key.lastUsedAt) > waiting.since)
        ? 5000
        : false,
  });

export const usePages = (projectId: string | undefined, languageId?: string, branchId?: string) =>
  useQuery(pagesQueryOptions(projectId, languageId, branchId));

/** A branch's Trash; the default branch when `branchId` is omitted. */
export const usePageTrash = (projectId: string | undefined, branchId?: string) => useQuery(pageTrashQueryOptions(projectId, branchId));

export const useLanguages = (projectId: string | undefined) => useQuery(languagesQueryOptions(projectId));

export const useBranches = (projectId: string | undefined) => useQuery(branchesQueryOptions(projectId));

export const usePage = (projectId: string | undefined, pageId: string | undefined) => useQuery(pageQueryOptions(projectId, pageId));

// Publishing is async (worker builds the snapshot). Poll while a deployment is
// in flight so the dashboard transitions PENDING/BUILDING → READY/FAILED on its
// own instead of appearing stuck until a manual refresh. The factory's fetch
// also checks whether a publish just went live, so published-state UI never
// trusts the pre-publish answer (see syncPublishReceipt).
/** Publishes that went live, newest first. Pair with {@link useDeployments}: a
 *  publish that just went live reaches the polled list first. */
export const useLiveDeployments = (projectId: string | undefined, options?: { enabled?: boolean }) =>
  useQuery({ ...liveDeploymentsQueryOptions(projectId), enabled: options?.enabled ?? true });

export const useDeployments = (
  projectId: string | undefined,
  options?: { enabled?: boolean; pollIntervalMs?: number; retryingDeploymentId?: string | null },
) =>
  useQuery({
    ...deploymentsQueryOptions(projectId),
    enabled: options?.enabled ?? true,
    refetchInterval: (query) =>
      query.state.data?.some(
        (d) => isDeploymentInFlight(d.status) || (d.id === options?.retryingDeploymentId && d.status === 'FAILED' && d.completedAt === null),
      )
        ? (options?.pollIntervalMs ?? 2500)
        : false,
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

/** Members + pending invitations for a single site (its own organization). */
export const useProjectMembers = (projectId: string | undefined) => useQuery(projectMembersQueryOptions(projectId));

/** `enabled: false` for Viewers, who cannot draft (the server refuses them). */
export const useAiDraftCapability = (projectId: string, options?: { enabled?: boolean }) =>
  useQuery({ ...aiDraftCapabilityQueryOptions(projectId), enabled: options?.enabled ?? true });

// ─── Notifications (bell inbox) ──────────────────────────────────────────────

/** The first inbox page (newest 50). Pass `enabled: false` until the popover opens. */
export const useNotifications = (options?: { enabled?: boolean; organizationId?: string }) =>
  useQuery({ ...notificationsQueryOptions(options?.organizationId), enabled: options?.enabled ?? true });

/** Unread badge count for the header bell. Polls every 60s. */
export const useUnreadNotificationCount = () => useQuery({ ...unreadNotificationCountQueryOptions(), refetchInterval: 60_000 });
