import type { IntegrationCatalogEntry } from '@nibleaf/shared/integrations';
import { queryOptions, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from './client-helpers';
import { liveDeploymentsKey, syncPublishReceipt } from './deployment-cache';
import type { ExportRun, ExportSchedule } from './exports';
import type { GitWorkflowStatus } from './git-workflow';
import { queryKeys } from './query-keys';
import type { ReaderAccessData } from './reader-access';
import type {
  ApiKeyList,
  Branch,
  BranchMergePreview,
  Comment,
  ConnectedApp,
  Deployment,
  Domain,
  Language,
  NotificationList,
  OpenApiConfiguration,
  Page,
  PageNode,
  PageTrashItem,
  Project,
  ProjectAddon,
  WorkspaceSettings,
} from './types';

/*
 * Query factories (`queryOptions`) are the single definition of each query: its
 * key (always from `queryKeys`), fetcher and per-query options. Hooks wrap them
 * with `useQuery(factory(...))`, and route loaders prefetch the same factory, so
 * a loader and a component can never disagree about a key. See
 * apps/app/DATA_LOADING.md.
 *
 * Keep this module light: route loaders import it directly, and a loader's
 * imports ship with the route's main chunk, which public pages also load. No
 * i18n, mutations or components here (type-only imports are erased, so types
 * may come from any hook module).
 *
 * Naming: hook `useFooBar` → factory `fooBarQueryOptions`. Polling
 * (`refetchInterval`) and other per-screen options stay on the hook.
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

/** A branch's Trash (the default branch when none is given), newest first. */
export const pageTrashQueryOptions = (projectId: string | undefined, branchId?: string) =>
  queryOptions({
    queryKey: queryKeys.pageTrash.list(projectId ?? '', branchId),
    queryFn: projectId
      ? async () =>
          getData<PageTrashItem[]>(
            await api.app.projects[':projectId']['page-trash'].$get({ param: { projectId }, query: branchId ? { branchId } : {} }),
            'trash',
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

/** Pages changed on main since the version was created, shown before promoting. */
export const branchMergePreviewQueryOptions = (projectId: string | undefined, branchId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.branches.mergePreview(projectId ?? '', branchId ?? ''),
    queryFn:
      projectId && branchId
        ? async () =>
            getData<BranchMergePreview>(
              await api.app.projects[':projectId'].branches[':id']['merge-preview'].$get({ param: { projectId, id: branchId } }),
              'merge preview',
            )
        : skipToken,
  });

export const deploymentsQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.deployments.all(projectId ?? ''),
    queryFn: projectId
      ? async ({ client }) => {
          const previous = client.getQueryData<Deployment[]>(queryKeys.deployments.all(projectId));
          const next = await getData<Deployment[]>(
            await api.app.projects[':projectId'].deployments.$get({ param: { projectId }, query: {} }),
            'deployments',
          );
          // Every read (hook, loader prefetch, poll) notices a publish that just went
          // live, so published-state UI never trusts the pre-publish answer.
          syncPublishReceipt(client, projectId, previous, next);
          return next;
        }
      : skipToken,
  });

/** Publishes that went live, newest first: what's live now and what a rollback can
 *  return to. The full list is the newest 50 attempts, so a run of failures can
 *  push every live version out of it. */
export const liveDeploymentsQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: liveDeploymentsKey(projectId ?? ''),
    queryFn: projectId
      ? async () =>
          getData<Deployment[]>(
            await api.app.projects[':projectId'].deployments.$get({ param: { projectId }, query: { status: 'READY' } }),
            'deployments',
          )
      : skipToken,
  });

export const pageQueryOptions = (projectId: string | undefined, pageId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.pages.detail(projectId ?? '', pageId ?? ''),
    queryFn:
      projectId && pageId
        ? async () => getData<Page>(await api.app.projects[':projectId'].pages[':id'].$get({ param: { projectId, id: pageId } }), 'page')
        : skipToken,
  });

// What the next publish will change vs. the last publish. Cheap to recompute, and
// the editor autosaves constantly, so it must follow every save: always stale.
export const pendingChangesQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.deployments.changes(projectId ?? ''),
    staleTime: 0,
    queryFn: projectId
      ? async () => getData(await api.app.projects[':projectId'].deployments.changes.$get({ param: { projectId } }), 'changes')
      : skipToken,
  });

export const projectAddonsQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.addons.all(projectId ?? ''),
    queryFn: projectId
      ? async () => getData<ProjectAddon[]>(await api.app.projects[':projectId'].addons.$get({ param: { projectId } }), 'project add-ons')
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

/** The integration catalog, with each provider's connection for this project. */
export const integrationsQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.integrations.all(projectId ?? ''),
    queryFn: projectId
      ? async () =>
          getData<IntegrationCatalogEntry[]>(await api.app.projects[':projectId'].integrations.$get({ param: { projectId } }), 'integrations')
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

export const domainsQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.domains.all(projectId ?? ''),
    queryFn: projectId
      ? async () => getData<Domain[]>(await api.app.projects[':projectId'].domains.$get({ param: { projectId } }), 'domains')
      : skipToken,
  });

export const openApiConfigurationQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.openapi.detail(projectId ?? ''),
    queryFn: projectId
      ? async () =>
          getData<OpenApiConfiguration | null>(await api.app.projects[':projectId'].openapi.$get({ param: { projectId } }), 'OpenAPI configuration')
      : skipToken,
  });

/** Per-site usage counters (content, team, publish activity, traffic, storage)
 *  rendered as plan-limit meters on the settings Usage tab. */
export const projectUsageQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.usage.forProject(projectId ?? ''),
    queryFn: projectId ? async () => getData(await api.app.projects[':projectId'].settings.usage.$get({ param: { projectId } }), 'usage') : skipToken,
  });

export const workspaceAiQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.workspaceAi.detail(projectId),
    queryFn: async () => getData(await api.app.projects[':projectId'].settings.ai.$get({ param: { projectId } }), 'Smart AI'),
  });

/** The site's own drafting capability (its Smart AI connection or the instance
 *  key), which decides whether the editor offers AI assist. */
export const aiDraftCapabilityQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.workspaceAi.draftCapability(projectId),
    queryFn: async () =>
      getData(await api.app.projects[':projectId'].ai['draft-capability'].$get({ param: { projectId } }), 'AI drafting availability'),
  });

export const commentsQueryOptions = (projectId: string | undefined, pageId?: string) =>
  queryOptions({
    queryKey: queryKeys.comments.all(projectId ?? '', pageId),
    queryFn: projectId
      ? async () =>
          getData<Comment[]>(
            await api.app.projects[':projectId'].comments.$get({ param: { projectId }, query: pageId ? { pageId } : {} }),
            'comments',
          )
      : skipToken,
  });

/** Workspace/site operational settings. Pass a projectId to read the SITE's own
 *  org settings (each site is its own workspace); omit it for the account view. */
export const workspaceSettingsQueryOptions = (projectId?: string) =>
  queryOptions({
    queryKey: projectId ? queryKeys.workspace.projectSettings(projectId) : queryKeys.workspace.settings(),
    queryFn: async () =>
      projectId
        ? getData<WorkspaceSettings>(await api.app.projects[':projectId'].settings.$get({ param: { projectId } }), 'site settings')
        : getData<WorkspaceSettings>(await api.app.workspace.$get(), 'workspace settings'),
  });

/** Members + pending invitations for a single site (its own organization). */
export const projectMembersQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.members.forProject(projectId ?? ''),
    queryFn: projectId ? async () => getData(await api.app.projects[':projectId'].members.$get({ param: { projectId } }), 'members') : skipToken,
    // Invitations are accepted elsewhere: never keep showing an accepted one as pending.
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

/** The first inbox page (newest 50). */
/** The bell inbox: every organization, or one (`organizationId`) for "This organization". */
export const notificationsQueryOptions = (organizationId?: string) =>
  queryOptions({
    queryKey: queryKeys.notifications.list(organizationId),
    queryFn: async () =>
      getData<NotificationList>(await api.app.notifications.$get({ query: organizationId ? { organizationId } : {} }), 'notifications'),
  });

/** Unread badge count for the header bell (the hook adds polling). */
export { unreadNotificationCountQueryOptions } from './notification-query-options';

// ─── Exports, Git workflow, reader access ────────────────────────────────────

export const listExportRunsQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.exports.runs(projectId ?? ''),
    queryFn: projectId
      ? async () => getData<ExportRun[]>(await api.app.projects[':projectId'].exports.$get({ param: { projectId } }), 'export runs')
      : skipToken,
  });

export const listExportSchedulesQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.exports.schedules(projectId ?? ''),
    queryFn: projectId
      ? async () =>
          getData<ExportSchedule[]>(await api.app.projects[':projectId'].exports.schedules.$get({ param: { projectId } }), 'export schedules')
      : skipToken,
  });

export const gitWorkflowQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.gitWorkflow.detail(projectId ?? ''),
    queryFn: projectId
      ? async () => getData<GitWorkflowStatus | null>(await api.app.projects[':projectId'].git.$get({ param: { projectId } }), 'Git workflow')
      : skipToken,
  });

export const readerAccessQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.readerAccess.detail(projectId ?? ''),
    queryFn: projectId
      ? async () =>
          getData<ReaderAccessData>(await api.app.projects[':projectId']['reader-access'].$get({ param: { projectId } }), 'reader access settings')
      : skipToken,
  });

// ─── Public (signed-out) ─────────────────────────────────────────────────────

/** Instance metadata (sign-up switch, sign-in providers, marketing analytics).
 *  Changes only with a deploy, so five minutes of freshness is plenty. */
export const getPublicMetaQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.public.meta(),
    queryFn: async () => getData(await api.public.meta.$get(), 'public instance metadata'),
    staleTime: 5 * 60 * 1000,
  });

/** What a join link offers. A bad, revoked, expired or used-up link is one 404. */
export const joinLinkPreviewQueryOptions = (token: string) =>
  queryOptions({
    queryKey: queryKeys.public.joinLink(token),
    queryFn: async () => getData(await api.public.join[':token'].$get({ param: { token } }), 'join link'),
    retry: false,
  });

export const getInvitationInfoQueryOptions = (invitationId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.public.invitation(invitationId ?? ''),
    queryFn: invitationId ? async () => getData(await api.public.invitations[':id'].$get({ param: { id: invitationId } }), 'invitation') : skipToken,
  });
