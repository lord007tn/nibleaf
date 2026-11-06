import { useT } from '@nibleaf/i18n/react';
import type { ResolvedTheme, ThemeConfigChange, ThemeTemplateV1 } from '@nibleaf/shared/themes';
import type {
  AddDomainBody,
  AiDraftBody,
  CreateApiKeyBody,
  CreateBranchBody,
  CreateCommentBody,
  CreateLanguageBody,
  CreatePageBody,
  CreateProjectBody,
  GitbookImportBody,
  InviteMemberBody,
  MarkNotificationsReadBody,
  MintlifyImportBody,
  ProjectConfigUpdate,
  ReorderPagesBody,
  RotateApiKeyBody,
  TransferOwnershipBody,
  UpdateLanguageBody,
  UpdateMemberRoleBody,
  UpdatePageBody,
  UpdateProjectAddonBody,
  UpdateProjectBody,
  UpdateWorkspaceSettingsBody,
  UpsertOpenApiBody,
} from '@nibleaf/validators';
import { inferSafeInlineAssetContentType } from '@nibleaf/validators';
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import type { FirstPublishAttribution } from '@/lib/first-publish-activation';
import { api } from '@/services/api';
import { ApiResponseError, getData, mutateData } from './client-helpers';
import { applyPageReorder, isPageListKey } from './page-cache';
import { queryKeys } from './query-keys';
import type {
  ApiKey,
  ApiKeySecret,
  Asset,
  Comment,
  Deployment,
  Language,
  NotificationItem,
  NotificationList,
  Page,
  PageNode,
  Project,
  ProjectAddon,
  WorkspaceSettings,
} from './types';

export interface ProjectThemeImportResult {
  applied: boolean;
  mode: 'merge' | 'replace';
  migratedFrom?: 0;
  changes: ThemeConfigChange[];
  theme: ResolvedTheme;
  template: ThemeTemplateV1;
  publishedChangesPending: boolean;
}

export const useExportProjectTheme = (projectId: string) =>
  useMutation({
    mutationFn: async () => getData(await api.app.projects[':id']['theme-template'].$get({ param: { id: projectId } }), 'theme template'),
  });

export const useImportProjectTheme = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ template, mode, apply }: { template: unknown; mode: 'merge' | 'replace'; apply: boolean }) =>
      mutateData(
        await api.app.projects[':id']['theme-template'].import.$post({
          param: { id: projectId },
          json: { template, mode, apply },
        }),
        apply ? 'Could not apply the theme template.' : 'Could not validate the theme template.',
      ),
    onSuccess: (_, variables) => {
      if (!variables.apply) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
    },
  });
};

export const useCreateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateProjectBody) => mutateData<Project>(await api.app.projects.$post({ json: body }), 'Could not create the site.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.projects.all() }),
  });
};

export const useCreateApiKey = (projectId: string) => {
  const queryClient = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (body: CreateApiKeyBody) =>
      mutateData<ApiKeySecret>(
        await api.app.projects[':projectId']['api-keys'].$post({ param: { projectId }, json: body }),
        t('settings.apiKeys.createError'),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all(projectId) }),
  });
};

export const useRotateApiKey = (projectId: string) => {
  const queryClient = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: RotateApiKeyBody }) =>
      mutateData<ApiKeySecret>(
        await api.app.projects[':projectId']['api-keys'][':id'].rotate.$post({ param: { projectId, id }, json: body }),
        t('settings.apiKeys.rotateError'),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all(projectId) }),
  });
};

export const useRevokeApiKey = (projectId: string) => {
  const queryClient = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData<ApiKey>(
        await api.app.projects[':projectId']['api-keys'][':id'].$delete({ param: { projectId, id } }),
        t('settings.apiKeys.revokeError'),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all(projectId) }),
  });
};

export const useUpdateProject = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateProjectBody) =>
      mutateData<Project>(await api.app.projects[':id'].$patch({ param: { id: projectId }, json: body }), 'Could not update the site.'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.all() });
      qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
    },
  });
};

/**
 * Convenience wrapper over the project PATCH for the per-project config blob.
 * `useUpdateProject` already accepts `config`/`icon` via `UpdateProjectBody`;
 * this sends just `{ config }` (and optionally `icon`).
 */
export const useUpdateProjectConfig = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ config, icon }: { config: ProjectConfigUpdate; icon?: string | null }) =>
      mutateData<Project>(
        await api.app.projects[':id'].$patch({ param: { id: projectId }, json: icon === undefined ? { config } : { config, icon } }),
        'Could not update the site configuration.',
      ),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.projects.all() }),
        qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) }),
      ]),
  });
};

export const useDeleteProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) =>
      mutateData(await api.app.projects[':id'].$delete({ param: { id: projectId } }), 'Could not delete the site.'),
    onSuccess: (_data, projectId) => {
      // Drop the deleted site's detail rather than refetching it into a "not found".
      qc.removeQueries({ queryKey: queryKeys.projects.detail(projectId), exact: true });
      return qc.invalidateQueries({ queryKey: queryKeys.projects.all() });
    },
  });
};

export const useUpsertOpenApi = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpsertOpenApiBody) =>
      mutateData(await api.app.projects[':projectId'].openapi.$put({ param: { projectId }, json: body }), 'Could not save the OpenAPI document.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.openapi.detail(projectId) }),
  });
};

export const useSyncOpenApi = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      mutateData(await api.app.projects[':projectId'].openapi.sync.$post({ param: { projectId } }), 'Could not refresh the OpenAPI document.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.openapi.detail(projectId) }),
  });
};

export const useDeleteOpenApi = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      mutateData(await api.app.projects[':projectId'].openapi.$delete({ param: { projectId } }), 'Could not remove the OpenAPI document.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.openapi.detail(projectId) }),
  });
};

export const useCreatePage = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreatePageBody) =>
      mutateData<Page>(await api.app.projects[':projectId'].pages.$post({ param: { projectId }, json: body }), 'Could not create the page.'),
    onSuccess: (created) => {
      // The response is the full page: seed its detail so the editor can open it
      // without a second round trip.
      qc.setQueryData(queryKeys.pages.detail(projectId, created.id), created);
      void qc.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
      return qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
    },
  });
};

export const useUpdatePage = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pageId, body }: { pageId: string; body: UpdatePageBody }) =>
      mutateData<Page>(
        await api.app.projects[':projectId'].pages[':id'].$patch({ param: { projectId, id: pageId }, json: body }),
        'Could not save the page.',
      ),
    onSuccess: (_data, { pageId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.pages.detail(projectId, pageId) });
      qc.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
    },
  });
};

export const useDeletePage = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pageId: string) =>
      mutateData(await api.app.projects[':projectId'].pages[':id'].$delete({ param: { projectId, id: pageId } }), 'Could not delete the page.'),
    onSuccess: (_data, pageId) => {
      qc.removeQueries({ queryKey: queryKeys.pages.detail(projectId, pageId), exact: true });
      void qc.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
      return qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
    },
  });
};

/** Reorder optimistically: the tree shows the drop result at once and rolls
 *  back if the server rejects it (the caller shows the error). */
export const useReorderPages = (projectId: string) => {
  const qc = useQueryClient();
  const listFilter = {
    queryKey: queryKeys.pages.allForProject(projectId),
    predicate: (query: { queryKey: readonly unknown[] }) => isPageListKey(query.queryKey),
  };
  return useMutation({
    mutationFn: async (body: ReorderPagesBody) =>
      mutateData(await api.app.projects[':projectId'].pages.reorder.$post({ param: { projectId }, json: body }), 'Could not reorder pages.'),
    onMutate: async (body) => {
      await qc.cancelQueries(listFilter);
      const previous = qc.getQueriesData<PageNode[]>(listFilter);
      for (const [key, pages] of previous) {
        if (Array.isArray(pages)) qc.setQueryData<PageNode[]>(key, applyPageReorder(pages, body.items));
      }
      return { previous };
    },
    onError: (_error, _body, context) => {
      for (const [key, pages] of context?.previous ?? []) qc.setQueryData(key, pages);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
      return qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
    },
  });
};

/** Every read a publish or rollback changes: the publish list, the live version,
 *  what the next publish would change and the sites list's publish summary. */
const invalidatePublishState = (qc: QueryClient, projectId: string) => {
  void qc.invalidateQueries({ queryKey: queryKeys.projects.all(), exact: true });
  void qc.invalidateQueries({ queryKey: queryKeys.deployments.all(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.deployments.latest(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
};

/** List a just-queued publish at once: the editor then knows a publish is running
 *  (a page's address stops following its title), and the poll that sees it go
 *  READY can tell it was in flight. */
const listQueuedPublish = (qc: QueryClient, projectId: string, deployment: Deployment) => {
  qc.setQueryData<Deployment[]>(queryKeys.deployments.all(projectId), (old) =>
    old && !old.some((item) => item.id === deployment.id) ? [deployment, ...old] : old,
  );
  invalidatePublishState(qc, projectId);
};

export const usePublish = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ message, firstPublishAttribution }: { message?: string; firstPublishAttribution?: FirstPublishAttribution }) =>
      mutateData<Deployment>(
        await api.app.projects[':projectId'].deployments.$post({
          param: { projectId },
          json: { ...(message ? { message } : {}), ...(firstPublishAttribution ? { firstPublishAttribution } : {}) },
        }),
        'Could not publish.',
      ),
    onSuccess: (deployment) => listQueuedPublish(qc, projectId, deployment),
  });
};

export const usePublishAnyway = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      mutateData<Deployment>(
        await api.app.projects[':projectId'].deployments.$post({ param: { projectId }, json: { skipGrammarChecks: true } }),
        'Could not publish.',
      ),
    onSuccess: (deployment) => listQueuedPublish(qc, projectId, deployment),
  });
};

export const useRollback = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deploymentId: string) =>
      mutateData<Deployment>(
        await api.app.projects[':projectId'].deployments[':id'].rollback.$post({ param: { projectId, id: deploymentId } }),
        'Could not roll back.',
      ),
    onSuccess: () => invalidatePublishState(qc, projectId),
  });
};

export const useAddDomain = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AddDomainBody) =>
      mutateData(await api.app.projects[':projectId'].domains.$post({ param: { projectId }, json: body }), 'Could not add the domain.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.domains.all(projectId) }),
  });
};

export const useVerifyDomain = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(await api.app.projects[':projectId'].domains[':id'].verify.$post({ param: { projectId, id } }), 'Could not verify.'),
    // Failed checks persist their actionable status before returning an error,
    // so refresh the row on both success and failure.
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.domains.all(projectId) }),
  });
};

export const useSetPrimaryDomain = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(
        await api.app.projects[':projectId'].domains[':id'].primary.$post({ param: { projectId, id } }),
        'Could not set the primary domain.',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.domains.all(projectId) }),
  });
};

export const useDeleteDomain = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(await api.app.projects[':projectId'].domains[':id'].$delete({ param: { projectId, id } }), 'Could not remove the domain.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.domains.all(projectId) }),
  });
};

/** Browsers occasionally omit File.type for valid images; never infer an active type. */
const uploadContentType = (file: File): string => file.type.trim() || inferSafeInlineAssetContentType(file.name) || 'application/octet-stream';

/** Presign → PUT bytes → confirm. Returns the recorded asset. */
export const useUploadAsset = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<Asset> => {
      const contentType = uploadContentType(file);
      const presign = await mutateData(
        await api.app.projects[':projectId'].assets.presign.$post({
          param: { projectId },
          json: { filename: file.name, contentType, size: file.size },
        }),
        'Could not start the upload.',
      );
      const put = await fetch(presign.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } });
      if (!put.ok) {
        // Keep the status so callers can tell "too large" from other failures.
        throw new ApiResponseError('Upload failed.', put.status);
      }
      return mutateData(
        await api.app.projects[':projectId'].assets.confirm.$post({
          param: { projectId },
          json: { key: presign.key, contentType, size: file.size },
        }),
        'Could not finalize the upload.',
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all(projectId) }),
  });
};

export const useInviteMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: InviteMemberBody) => mutateData(await api.app.members.invite.$post({ json: body }), 'Could not send the invite.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members.all() }),
  });
};

export const useUpdateMemberRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateMemberRoleBody }) =>
      mutateData(await api.app.members[':id'].role.$patch({ param: { id }, json: body }), 'Could not update the role.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members.all() }),
  });
};

export const useRemoveMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => mutateData(await api.app.members[':id'].$delete({ param: { id } }), 'Could not remove the member.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members.all() }),
  });
};

// ─── Per-site members (each site owns its own people/roles) ──────────────────

export const useInviteProjectMember = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: InviteMemberBody) =>
      mutateData(await api.app.projects[':projectId'].members.invite.$post({ param: { projectId }, json: body }), 'Could not send the invite.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members.forProject(projectId) }),
  });
};

export const useUpdateProjectMemberRole = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateMemberRoleBody }) =>
      mutateData(
        await api.app.projects[':projectId'].members[':id'].role.$patch({ param: { projectId, id }, json: body }),
        'Could not update the role.',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members.forProject(projectId) }),
  });
};

export const useTransferProjectOwnership = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: TransferOwnershipBody) =>
      mutateData(
        await api.app.projects[':projectId'].members['transfer-ownership'].$post({ param: { projectId }, json: body }),
        'Could not transfer ownership.',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members.forProject(projectId) }),
  });
};

export const useRemoveProjectMember = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(await api.app.projects[':projectId'].members[':id'].$delete({ param: { projectId, id } }), 'Could not remove the member.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members.forProject(projectId) }),
  });
};

export const useCancelProjectInvitation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(
        await api.app.projects[':projectId'].members.invitations[':id'].$delete({ param: { projectId, id } }),
        'Could not revoke the invitation.',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members.forProject(projectId) }),
  });
};

// ─── Comments ─────────────────────────────────────────────────────────────—

/** Optimistically edit every cached comment list of a site (site-wide and per
 *  page); returns the previous lists so `onError` can roll them back. */
const patchCommentLists = async (qc: QueryClient, projectId: string, update: (comments: Comment[]) => Comment[]) => {
  const filter = { queryKey: queryKeys.comments.allForProject(projectId) };
  await qc.cancelQueries(filter);
  const previous = qc.getQueriesData<Comment[]>(filter);
  qc.setQueriesData<Comment[]>(filter, (comments) => (comments ? update(comments) : comments));
  return { previous };
};

// The site-wide list shows a new page comment too, so every list of the site is
// refreshed (`pageId` stays in the signature for existing callers).
export const useCreateComment = (projectId: string, _pageId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateCommentBody) =>
      mutateData<Comment>(await api.app.projects[':projectId'].comments.$post({ param: { projectId }, json: body }), 'Could not post the comment.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.comments.allForProject(projectId) }),
  });
};

/**
 * Resolve/reopen optimistically: flipping the flag has only one outcome.
 *
 * The server stores whatever `resolved` it is sent, so a quick Resolve → Reopen
 * must reach it in click order. Every resolve write of a site shares one
 * mutation scope, which runs them one after another (each optimistic update
 * still shows at once), so the last click is what's saved. A failure rolls back
 * only that comment, and only if no later click changed it since; the list is
 * refetched once the last write has finished.
 */
export const useResolveComment = (projectId: string) => {
  const qc = useQueryClient();
  const mutationKey = ['comments', 'resolve', projectId];
  const filter = { queryKey: queryKeys.comments.allForProject(projectId) };
  return useMutation({
    mutationKey,
    scope: { id: `comments.resolve.${projectId}` },
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) =>
      mutateData<Comment>(
        await api.app.projects[':projectId'].comments[':id'].$patch({ param: { projectId, id }, json: { resolved } }),
        'Could not update the comment.',
      ),
    onMutate: async ({ id, resolved }) => {
      const { previous } = await patchCommentLists(qc, projectId, (comments) =>
        comments.map((comment) => (comment.id === id ? { ...comment, resolved } : comment)),
      );
      const before = previous.flatMap(([, comments]) => comments ?? []).find((comment) => comment.id === id);
      return { previousResolved: before?.resolved };
    },
    onError: (_error, { id, resolved }, context) => {
      const previousResolved = context?.previousResolved;
      if (previousResolved === undefined) return;
      qc.setQueriesData<Comment[]>(filter, (comments) =>
        comments?.map((comment) => (comment.id === id && comment.resolved === resolved ? { ...comment, resolved: previousResolved } : comment)),
      );
    },
    // A refetch while a later write is still queued would briefly show the older answer.
    onSettled: () => (qc.isMutating({ mutationKey }) > 1 ? undefined : qc.invalidateQueries(filter)),
  });
};

/** Delete optimistically (the comment disappears at once); on failure only that comment comes back, where it was. */
export const useDeleteComment = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(await api.app.projects[':projectId'].comments[':id'].$delete({ param: { projectId, id } }), 'Could not delete the comment.'),
    onMutate: (id) => patchCommentLists(qc, projectId, (comments) => comments.filter((comment) => comment.id !== id)),
    onError: (_error, id, context) => {
      for (const [key, comments] of context?.previous ?? []) {
        const index = comments?.findIndex((comment) => comment.id === id) ?? -1;
        const removed = comments?.[index];
        if (!removed) continue;
        // Re-insert into the current list, so changes made to other comments meanwhile are kept.
        qc.setQueryData<Comment[]>(key, (current) =>
          current && !current.some((comment) => comment.id === id) ? [...current.slice(0, index), removed, ...current.slice(index)] : current,
        );
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.comments.allForProject(projectId) }),
  });
};

// ─── AI drafting assistant ───────────────────────────────────────────────────

export const useAiDraft = (projectId: string) =>
  useMutation({
    mutationFn: async (body: AiDraftBody) =>
      mutateData(await api.app.projects[':projectId'].ai.$post({ param: { projectId }, json: body }), 'Could not draft content.'),
  });

// ─── Languages ───────────────────────────────────────────────────────────────

export const useCreateLanguage = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateLanguageBody) =>
      mutateData<Language>(await api.app.projects[':projectId'].languages.$post({ param: { projectId }, json: body }), 'Could not add the language.'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.languages.all(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
    },
  });
};

export const useUpdateLanguage = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateLanguageBody }) =>
      mutateData<Language>(
        await api.app.projects[':projectId'].languages[':id'].$patch({ param: { projectId, id }, json: body }),
        'Could not update the language.',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.languages.all(projectId) }),
  });
};

export const useDeleteLanguage = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(await api.app.projects[':projectId'].languages[':id'].$delete({ param: { projectId, id } }), 'Could not delete the language.'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.languages.all(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
    },
  });
};

// ─── Branches ────────────────────────────────────────────────────────────────

export const useCreateBranch = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateBranchBody) =>
      mutateData(await api.app.projects[':projectId'].branches.$post({ param: { projectId }, json: body }), 'Could not create the branch.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.branches.all(projectId) }),
  });
};

export const useMergeBranch = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(await api.app.projects[':projectId'].branches[':id'].merge.$post({ param: { projectId, id } }), 'Could not merge the branch.'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.branches.all(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
    },
  });
};

// ─── Workspace settings ──────────────────────────────────────────────────────

export const useUpdateProjectAddon = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ addonId, body }: { addonId: string; body: UpdateProjectAddonBody }) =>
      mutateData<ProjectAddon>(
        await api.app.projects[':projectId'].addons[':addonId'].$patch({ param: { projectId, addonId }, json: body }),
        'Could not update the add-on.',
      ),
    onSuccess: (addon) => {
      qc.setQueryData(queryKeys.addons.detail(projectId, addon.id), addon);
      qc.invalidateQueries({ queryKey: queryKeys.addons.all(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
    },
    onError: async (error, variables) => {
      if (error instanceof ApiResponseError && error.code === 'addon:revision_conflict') {
        await Promise.all([
          qc.invalidateQueries({ queryKey: queryKeys.addons.detail(projectId, variables.addonId), exact: true, refetchType: 'all' }),
          qc.invalidateQueries({ queryKey: queryKeys.addons.all(projectId), exact: true, refetchType: 'all' }),
        ]);
      }
    },
  });
};

const useSetProjectAddonEnabled = (projectId: string, action: 'activate' | 'deactivate') => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ addonId, expectedRevision }: { addonId: string; expectedRevision: number }) => {
      const response =
        action === 'activate'
          ? await api.app.projects[':projectId'].addons[':addonId'].activate.$post({ param: { projectId, addonId }, json: { expectedRevision } })
          : await api.app.projects[':projectId'].addons[':addonId'].deactivate.$post({ param: { projectId, addonId }, json: { expectedRevision } });
      return mutateData<ProjectAddon>(response, action === 'activate' ? 'Could not enable the add-on.' : 'Could not disable the add-on.');
    },
    onSuccess: (addon) => {
      qc.setQueryData(queryKeys.addons.detail(projectId, addon.id), addon);
      qc.invalidateQueries({ queryKey: queryKeys.addons.all(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
    },
    onError: async (error, variables) => {
      if (error instanceof ApiResponseError && error.code === 'addon:revision_conflict') {
        await Promise.all([
          qc.invalidateQueries({ queryKey: queryKeys.addons.detail(projectId, variables.addonId), exact: true, refetchType: 'all' }),
          qc.invalidateQueries({ queryKey: queryKeys.addons.all(projectId), exact: true, refetchType: 'all' }),
        ]);
      }
    },
  });
};

export const useActivateProjectAddon = (projectId: string) => useSetProjectAddonEnabled(projectId, 'activate');
export const useDeactivateProjectAddon = (projectId: string) => useSetProjectAddonEnabled(projectId, 'deactivate');

/** Update workspace/site settings. Pass a projectId to write the SITE's own org
 *  settings (per-site workspace); omit it for the account view. */
export const useUpdateWorkspaceSettings = (projectId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateWorkspaceSettingsBody) =>
      projectId
        ? mutateData<WorkspaceSettings>(
            await api.app.projects[':projectId'].settings.$patch({ param: { projectId }, json: body }),
            'Could not update settings.',
          )
        : mutateData<WorkspaceSettings>(await api.app.workspace.$patch({ json: body }), 'Could not update workspace settings.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectId ? queryKeys.workspace.projectSettings(projectId) : queryKeys.workspace.settings() }),
  });
};

/** Pull Markdown pages from the configured public Git provider (one-way import). */
export const useImportFromGit = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      mutateData(await api.app.projects[':projectId'].settings.git.import.$post({ param: { projectId } }), 'Could not import from Git.'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.workspace.projectSettings(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
    },
  });
};

/** Generate or rotate the push-to-deploy webhook secret (admin only). The
 *  secret is server-generated; the settings PATCH can never set it. */
export const useRotateGitWebhookSecret = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      mutateData(
        await api.app.projects[':projectId'].settings.git['webhook-secret'].$post({ param: { projectId } }),
        'Could not rotate the webhook secret.',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.workspace.projectSettings(projectId) }),
  });
};

// ─── Content importers (Mintlify / Ghost) ────────────────────────────────────

/** Summary returned by the content importers (Mintlify, Ghost, …). */
export interface ContentImportSummary {
  imported: number;
  updated: number;
  skipped: number;
  assetsImported?: number;
  assetsSkipped?: number;
  warnings: string[];
}

/** One-way import of a public Mintlify GitHub docs repo (docs.json / mint.json). */
export const useImportFromMintlify = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: MintlifyImportBody) =>
      mutateData(
        await api.app.projects[':projectId'].settings.import.mintlify.$post({ param: { projectId }, json: body }),
        'Could not import from Mintlify.',
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
      // The importer may also fill empty project-config keys (branding, navbar, …).
      qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.projects.all() });
    },
  });
};

/** One-way import of a public GitBook Git Sync GitHub repo (.gitbook.yaml / SUMMARY.md). */
export const useImportFromGitbook = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: GitbookImportBody) =>
      mutateData(
        await api.app.projects[':projectId'].settings.import.gitbook.$post({ param: { projectId }, json: body }),
        'Could not import from GitBook.',
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
      // Redirects from .gitbook.yaml may be written to the project config.
      qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.projects.all() });
    },
  });
};

/** One-way import of a Ghost JSON export (published posts + pages → Markdown). */
export const useImportFromGhost = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      mutateData(
        await api.app.projects[':projectId'].settings.import.ghost.$post({ param: { projectId }, json: body }),
        'Could not import from Ghost.',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) }),
  });
};

// ─── Notifications (bell inbox) ──────────────────────────────────────────────

/**
 * Mark notifications read — pass `{ ids }` for specific rows or `{ all: true }`.
 * Optimistic (marking read always succeeds unless the request fails): the rows
 * and the bell's count change at once, and both roll back if the server refuses.
 */
export const useMarkNotificationsRead = () => {
  const qc = useQueryClient();
  const t = useT();
  const listKey = queryKeys.notifications.list();
  const countKey = queryKeys.notifications.unreadCount();
  return useMutation({
    mutationFn: async (body: MarkNotificationsReadBody) =>
      mutateData(await api.app.notifications.read.$post({ json: body }), 'Could not update notifications.'),
    onMutate: async (body) => {
      await Promise.all([qc.cancelQueries({ queryKey: listKey, exact: true }), qc.cancelQueries({ queryKey: countKey, exact: true })]);
      const previousList = qc.getQueryData<NotificationList>(listKey);
      const previousCount = qc.getQueryData<{ count: number }>(countKey);
      const targets = body.all ? null : new Set(body.ids ?? []);
      const marks = (item: NotificationItem) => item.readAt === null && (targets === null || targets.has(item.id));
      const readAt = new Date().toISOString();
      // Rows not in the cached page are assumed unread, so the count never stays too high.
      const newlyRead =
        targets === null
          ? Number.POSITIVE_INFINITY
          : [...targets].filter((id) => previousList?.items.find((item) => item.id === id)?.readAt == null).length;
      if (previousList) {
        qc.setQueryData<NotificationList>(listKey, {
          ...previousList,
          items: previousList.items.map((item) => (marks(item) ? { ...item, readAt } : item)),
        });
      }
      if (previousCount) qc.setQueryData<{ count: number }>(countKey, { ...previousCount, count: Math.max(0, previousCount.count - newlyRead) });
      return { previousList, previousCount };
    },
    onError: (_error, _body, context) => {
      if (context?.previousList) qc.setQueryData(listKey, context.previousList);
      if (context?.previousCount) qc.setQueryData(countKey, context.previousCount);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: listKey, exact: true });
      void qc.invalidateQueries({ queryKey: countKey, exact: true });
    },
    meta: { errorMessage: t('notifications.markReadError') },
  });
};
