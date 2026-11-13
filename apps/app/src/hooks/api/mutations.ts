import { useT } from '@nibleaf/i18n/react';
import { resolvePageMove } from '@nibleaf/shared/page-moves';
import type { ResolvedTheme, ThemeConfigChange, ThemeTemplateV1 } from '@nibleaf/shared/themes';
import type {
  AiDraftBody,
  CreateApiKeyBody,
  CreateBranchBody,
  CreateCommentBody,
  CreateLanguageBody,
  CreatePageBody,
  CreateProjectBody,
  GitbookImportBody,
  MarkNotificationsReadBody,
  MintlifyImportBody,
  ProjectConfigUpdate,
  ReorderPagesBody,
  RotateApiKeyBody,
  UpdateLanguageBody,
  UpdatePageBody,
  UpdateProjectAddonBody,
  UpdateProjectBody,
  UpdateWorkspaceSettingsBody,
  UpsertOpenApiBody,
} from '@nibleaf/validators';
import { inferSafeInlineAssetContentType } from '@nibleaf/validators';
import { type QueryClient, useIsMutating } from '@tanstack/react-query';
import { useRef } from 'react';
import { organizationKeys } from '@/hooks/api/organization-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import type { FirstPublishAttribution } from '@/lib/first-publish-activation';
import { putAsset } from '@/lib/upload-asset-put';
import { api } from '@/services/api';
import { ApiResponseError, getData, mutateData } from './client-helpers';
import { friendlyErrorMessage } from './errors';
import { applyPageReorder, applyPageReorderToList, isNewerRevision, isPageListKey, newerRevision, rollbackPageReorder } from './page-cache';
import { acquirePageMove } from './page-move-queue';
import { queryKeys } from './query-keys';
import type {
  ApiKey,
  ApiKeyList,
  ApiKeySecret,
  Asset,
  Comment,
  Deployment,
  Language,
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
    // Websites are always created inside an organization (`organizationId`).
    mutationFn: async (body: CreateProjectBody) =>
      mutateData<Project & { firstPageId: string | null }>(await api.app.projects.$post({ json: body }), 'Could not create the site.'),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.projects.all() }),
        qc.invalidateQueries({ queryKey: organizationKeys.organizations.all() }),
        qc.invalidateQueries({ queryKey: organizationKeys.me.switcher() }),
      ]),
  });
};

/** Where a one-time secret goes: straight to the caller, never into the mutation cache. */
export type DeliverSecret = (key: { id: string; secret: string }) => void;

/** Hands the secret to `deliver` and returns the key without it, so neither the
 *  cached mutation result nor its variables ever hold the secret. */
const withoutSecret = ({ secret, ...key }: ApiKeySecret, deliver: DeliverSecret): ApiKey => {
  deliver({ id: key.id, secret });
  return key;
};

export const useCreateApiKey = (projectId: string) => {
  const queryClient = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async ({ body, deliver }: { body: CreateApiKeyBody; deliver: DeliverSecret }) =>
      withoutSecret(
        await mutateData<ApiKeySecret>(
          await api.app.projects[':projectId']['api-keys'].$post({ param: { projectId }, json: body }),
          t('settings.apiKeys.createError'),
        ),
        deliver,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all(projectId) }),
    meta: { errorMessage: t('settings.apiKeys.createError') },
  });
};

export const useRotateApiKey = (projectId: string) => {
  const queryClient = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async ({ id, body, deliver }: { id: string; body: RotateApiKeyBody; deliver: DeliverSecret }) =>
      withoutSecret(
        await mutateData<ApiKeySecret>(
          await api.app.projects[':projectId']['api-keys'][':id'].rotate.$post({ param: { projectId, id }, json: body }),
          t('settings.apiKeys.rotateError'),
        ),
        deliver,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all(projectId) }),
    meta: { errorMessage: t('settings.apiKeys.rotateError') },
  });
};

export const useRevokeApiKey = (projectId: string) => {
  const queryClient = useQueryClient();
  const t = useT();
  const queryKey = queryKeys.apiKeys.all(projectId);
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData<ApiKey>(
        await api.app.projects[':projectId']['api-keys'][':id'].$delete({ param: { projectId, id } }),
        t('settings.apiKeys.revokeError'),
      ),
    // Optimistic: revoking only ever succeeds or leaves the key as it was, so mark
    // it revoked at once and put the previous list back if the call fails.
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ApiKeyList>(queryKey);
      const revokedAt = new Date().toISOString();
      queryClient.setQueryData<ApiKeyList>(queryKey, (list) =>
        list
          ? { ...list, data: list.data.map((key) => (key.id === id ? { ...key, revokedAt: key.revokedAt ?? revokedAt, state: 'revoked' } : key)) }
          : list,
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
    meta: { errorMessage: t('settings.apiKeys.revokeError') },
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
      return Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.projects.all() }),
        qc.invalidateQueries({ queryKey: organizationKeys.organizations.all() }),
        qc.invalidateQueries({ queryKey: organizationKeys.me.switcher() }),
      ]);
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

export const useCreatePage = (projectId: string, options?: { reportErrors?: boolean }) => {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    networkMode: 'always',
    meta: options?.reportErrors === false ? undefined : { errorMessage: (error) => friendlyErrorMessage(t, error, 'editor.createFailed') },
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

/** Copy a page (a group without its pages) right after itself, with its content and settings. */
export const useDuplicatePage = (projectId: string) => {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    networkMode: 'always',
    meta: { errorMessage: (error) => friendlyErrorMessage(t, error, 'editor.duplicateFailed') },
    mutationFn: async (pageId: string) =>
      mutateData<Page>(
        await api.app.projects[':projectId'].pages[':id'].duplicate.$post({ param: { projectId, id: pageId } }),
        'Could not duplicate the page.',
      ),
    onSuccess: (created) => {
      qc.setQueryData(queryKeys.pages.detail(projectId, created.id), created);
      void qc.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
      return qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
    },
  });
};

export const useUpdatePage = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    // Let failed offline requests settle rather than pause forever as pending.
    networkMode: 'always',
    onMutate: ({ pageId }) => qc.cancelQueries({ queryKey: queryKeys.pages.detail(projectId, pageId), exact: true }),
    mutationFn: async ({ pageId, body }: { pageId: string; body: UpdatePageBody }) =>
      mutateData<
        Page & {
          addressChanged: boolean;
          redirectsAdded: number;
          linksUpdated: number;
          documentsSkipped: number;
          historySnapshot: 'stored' | 'unchanged' | 'throttled' | 'too-large';
        }
      >(await api.app.projects[':projectId'].pages[':id'].$patch({ param: { projectId, id: pageId }, json: body }), 'Could not save the page.'),
    onSuccess: (data, { pageId, body }) => {
      // Saves can resolve out of order (an autosave and a rename from the tree),
      // so a response never replaces a newer revision already in the cache.
      qc.setQueryData<Page>(queryKeys.pages.detail(projectId, pageId), (cached) => newerRevision(cached, data));
      const structural = data.addressChanged || body.slug !== undefined || body.parentId !== undefined;
      if (structural) {
        void qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
        if (data.addressChanged) void qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      } else {
        qc.setQueriesData<PageNode[]>(
          { queryKey: queryKeys.pages.allForProject(projectId), predicate: (query) => isPageListKey(query.queryKey) },
          (pages) =>
            pages?.map((page) =>
              page.id === pageId && !isNewerRevision(page, data)
                ? {
                    ...page,
                    title: data.title,
                    description: data.description,
                    icon: data.icon,
                    config: data.config,
                    hidden: data.hidden,
                    translationKey: data.translationKey,
                    updatedAt: data.updatedAt,
                  }
                : page,
            ),
        );
      }
      // Publish readiness includes content changes even when the tree does not.
      void qc.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
    },
  });
};

/** What deleting a page answers: the Trash item that holds it, for Undo. */
export interface DeletedPage {
  id: string;
  trashId: string;
  pageCount: number;
  expiresAt: string;
}

export const useDeletePage = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pageId: string) =>
      mutateData<DeletedPage>(
        await api.app.projects[':projectId'].pages[':id'].$delete({ param: { projectId, id: pageId } }),
        'Could not delete the page.',
      ),
    onSuccess: (_data, pageId) => {
      qc.removeQueries({ queryKey: queryKeys.pages.detail(projectId, pageId), exact: true });
      void qc.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
      void qc.invalidateQueries({ queryKey: queryKeys.pageTrash.all(projectId) });
      return qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
    },
  });
};

/** Reorder optimistically: the tree shows the drop result at once and rolls
 *  back if the server rejects it (the caller shows the error). */
export const useReorderPages = (projectId: string) => {
  const qc = useQueryClient();
  const mutationKey = ['page-reorder', projectId];
  const listFilter = {
    queryKey: queryKeys.pages.allForProject(projectId),
    predicate: (query: { queryKey: readonly unknown[] }) => isPageListKey(query.queryKey),
  };
  const mutation = useMutation({
    mutationKey,
    scope: { id: `page-reorder:${projectId}` },
    mutationFn: async (body: ReorderPagesBody) =>
      mutateData<PageNode[]>(
        await api.app.projects[':projectId'].pages.reorder.$post({ param: { projectId }, json: body }),
        'Could not reorder pages.',
      ),
    onMutate: async (body) => {
      const release = await acquirePageMove(qc, projectId, body);
      let unsubscribe: () => void = () => undefined;
      try {
        await qc.cancelQueries(listFilter);
        const previous = qc.getQueriesData<PageNode[]>(listFilter);
        // Every cached page after the move, so a list filtered to one language can
        // take in the pages that moved into it from another language.
        const known = new Map<string, PageNode>();
        for (const [, pages] of previous) {
          if (Array.isArray(pages)) for (const page of pages) known.set(page.id, page);
        }
        const items = 'items' in body ? body.items : (resolvePageMove([...known.values()], body) ?? []);
        for (const page of applyPageReorder([...known.values()], items)) known.set(page.id, page);
        const refetched = new Set<string>();
        const watched = new Set(previous.map(([key]) => qc.getQueryCache().find({ queryKey: key, exact: true })?.queryHash));
        unsubscribe = qc.getQueryCache().subscribe((event) => {
          if (event.type === 'updated' && event.action.type === 'success' && !event.action.manual && watched.has(event.query.queryHash))
            refetched.add(event.query.queryHash);
        });
        const snapshots: Array<{ key: readonly unknown[]; before: PageNode[]; optimistic: PageNode[] }> = [];
        for (const [key, pages] of previous) {
          if (!Array.isArray(pages)) continue;
          const scope = { languageId: typeof key[2] === 'string' ? key[2] : null, branchId: typeof key[3] === 'string' ? key[3] : null };
          qc.setQueryData<PageNode[]>(key, applyPageReorderToList(pages, items, scope, known));
          snapshots.push({ key, before: pages, optimistic: qc.getQueryData<PageNode[]>(key) ?? [] });
        }
        return { snapshots, refetched, release, unsubscribe };
      } catch (error) {
        unsubscribe();
        release();
        throw error;
      }
    },
    onError: (_error, _body, context) => {
      for (const { key, before, optimistic } of context?.snapshots ?? []) {
        const query = qc.getQueryCache().find({ queryKey: key, exact: true });
        if (!query || context?.refetched.has(query.queryHash)) continue;
        qc.setQueryData<PageNode[]>(key, (current) => (Array.isArray(current) ? rollbackPageReorder(current, before, optimistic) : current));
      }
    },
    onSettled: async (_data, _error, _body, context) => {
      try {
        void qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
        void qc.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
        await qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
      } finally {
        context?.unsubscribe();
        context?.release();
      }
    },
  });
  const pending = useIsMutating({ mutationKey }) > 0;
  return { ...mutation, isPending: pending };
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
    !old?.some((item) => item.id === deployment.id) ? [deployment, ...(old ?? [])] : old,
  );
  invalidatePublishState(qc, projectId);
};

export const usePublish = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      message,
      firstPublishAttribution,
      reviewedStateHash,
    }: {
      message?: string;
      firstPublishAttribution?: FirstPublishAttribution;
      reviewedStateHash?: string;
    }) =>
      mutateData<Deployment>(
        await api.app.projects[':projectId'].deployments.$post({
          param: { projectId },
          json: { reviewedStateHash, ...(message ? { message } : {}), ...(firstPublishAttribution ? { firstPublishAttribution } : {}) },
        }),
        'Could not publish.',
      ),
    onSuccess: (deployment) => listQueuedPublish(qc, projectId, deployment),
  });
};

export const usePublishAnyway = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reviewedDeploymentId: string) =>
      mutateData<Deployment>(
        await api.app.projects[':projectId'].deployments.$post({ param: { projectId }, json: { skipGrammarChecks: true, reviewedDeploymentId } }),
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
    onSuccess: (deployment) => listQueuedPublish(qc, projectId, deployment),
  });
};

/** Browsers occasionally omit File.type for valid images; never infer an active type. */
const uploadContentType = (file: File): string => file.type.trim() || inferSafeInlineAssetContentType(file.name) || 'application/octet-stream';

type AssetUploadAttempt = { key: string; uploadUrl: string; contentType: string; putComplete: boolean };

/** Presign → PUT bytes → confirm. Returns the recorded asset. */
export const useUploadAsset = (projectId: string) => {
  const qc = useQueryClient();
  // A Retry uses the same File instance. Retain storage identity per project
  // for the File's lifetime, including across mutation/hook re-renders. A later
  // insertion failure must not turn Retry into a second storage upload either.
  const attempts = useRef(new WeakMap<File, Map<string, AssetUploadAttempt>>());
  return useMutation({
    mutationFn: async (
      input: File | { file: File; onProgress?: (percent: number) => void; signal?: AbortSignal; onFinishing?: () => void },
    ): Promise<Asset> => {
      const file = input instanceof File ? input : input.file;
      const onProgress = input instanceof File ? undefined : input.onProgress;
      const signal = input instanceof File ? undefined : input.signal;
      const contentType = uploadContentType(file);
      const perProject = attempts.current.get(file) ?? new Map<string, AssetUploadAttempt>();
      let attempt = perProject.get(projectId);
      if (!attempt) {
        const presign = await mutateData(
          await api.app.projects[':projectId'].assets.presign.$post(
            {
              param: { projectId },
              json: { filename: file.name, contentType, size: file.size },
            },
            { init: { signal } },
          ),
          'Could not start the upload.',
        );
        attempt = { ...presign, putComplete: false };
        perProject.set(projectId, attempt);
        attempts.current.set(file, perProject);
      }
      if (!attempt.putComplete) {
        try {
          await putAsset(attempt.uploadUrl, file, attempt.contentType, onProgress, signal);
        } catch (error) {
          // API capabilities are single use, including interrupted attempts.
          if (attempt.uploadUrl.startsWith('/api/')) perProject.delete(projectId);
          throw error;
        }
        attempt.putComplete = true;
      }
      if (!(input instanceof File)) input.onFinishing?.();
      const { key, contentType: signedContentType } = attempt;
      let asset: Asset;
      try {
        asset = await mutateData(
          await api.app.projects[':projectId'].assets.confirm.$post(
            {
              param: { projectId },
              json: { key, contentType: signedContentType, size: file.size },
            },
            { init: { signal } },
          ),
          'Could not finalize the upload.',
        );
      } catch (confirmationError) {
        if (signal?.aborted) throw confirmationError;
        // Confirm is idempotent for the same key, so Retry normally gets the
        // recorded asset back. If confirm still fails, look for the exact
        // recorded key; never infer success from the error status.
        let existing: Asset | undefined;
        try {
          const assets = await getData(await api.app.projects[':projectId'].assets.$get({ param: { projectId } }, { init: { signal } }), 'assets');
          existing = assets.find((item) => item.key === key && item.size === file.size && item.contentType === signedContentType);
        } catch {
          throw confirmationError;
        }
        if (!existing) throw confirmationError;
        asset = existing;
      }
      return asset;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all(projectId) }),
  });
};

/** Delete an upload this editor session recorded but never placed. The server
 *  keeps any file that saved content still uses (409 asset:in_use). */
export const useDeleteAsset = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assetId: string) =>
      mutateData(await api.app.projects[':projectId'].assets[':assetId'].$delete({ param: { projectId, assetId } }), 'Could not delete the file.'),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all(projectId) }),
  });
};

// ─── Overlapping writes ──────────────────────────────────────────────────────

let lastWriteToken = 0;
// A plain function keeps the counter out of hook bodies (the React Compiler can't analyse `++` on module state).
const nextWriteToken = () => {
  lastWriteToken += 1;
  return lastWriteToken;
};

/**
 * Bookkeeping shared by every caller of an optimistic hook whose writes can
 * overlap: one record per query client, created on first use and dropped once
 * the last write has finished. Each write gets a `token` so it can tell its own
 * claims from the others'. See DATA_LOADING.md → "Overlapping writes".
 */
const overlappingWrites = <State>(create: () => State) => {
  const states = new WeakMap<QueryClient, State>();
  return {
    of: (qc: QueryClient) => {
      let state = states.get(qc);
      if (!state) {
        state = create();
        states.set(qc, state);
      }
      return state;
    },
    peek: (qc: QueryClient) => states.get(qc),
    drop: (qc: QueryClient) => states.delete(qc),
    nextToken: nextWriteToken,
  };
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
 * Resolve/reopen intents per comment, per query client: the value the server
 * last confirmed and every click still waiting for its write, in click order.
 */
type ResolveIntents = { confirmed: boolean | undefined; pending: { token: number; resolved: boolean }[] };
const resolveIntents = overlappingWrites(() => new Map<string, ResolveIntents>());

/**
 * Resolve/reopen optimistically: flipping the flag has only one outcome.
 *
 * The server stores whatever `resolved` it is sent, so a quick Resolve → Reopen
 * must reach it in click order. Every resolve write of a site shares one
 * mutation scope, which runs them one after another (each optimistic update
 * still shows at once), so the last click is what's saved.
 *
 * What a comment shows is always its newest click still in flight, or else the
 * value the server last confirmed. A failed write is dropped from that list, so
 * it can only change what's shown when it was the newest click — an older
 * failure never undoes a later Resolve or Reopen, however many are queued.
 * Every failure is reported (the message is in `meta`, which runs once per
 * failed write), and the list is refetched once the last write has finished.
 */
export const useResolveComment = (projectId: string) => {
  const qc = useQueryClient();
  const t = useT();
  const mutationKey = ['comments', 'resolve', projectId];
  const filter = { queryKey: queryKeys.comments.allForProject(projectId) };
  const show = (id: string, entry: ResolveIntents) => {
    const resolved = entry.pending.at(-1)?.resolved ?? entry.confirmed;
    if (resolved === undefined) return;
    qc.setQueriesData<Comment[]>(filter, (comments) =>
      comments?.map((comment) => (comment.id === id && comment.resolved !== resolved ? { ...comment, resolved } : comment)),
    );
  };
  return useMutation({
    mutationKey,
    scope: { id: `comments.resolve.${projectId}` },
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) =>
      mutateData<Comment>(
        await api.app.projects[':projectId'].comments[':id'].$patch({ param: { projectId, id }, json: { resolved } }),
        'Could not update the comment.',
      ),
    onMutate: async ({ id, resolved }) => {
      // Registered before any await, so the list follows click order (the order the writes run in).
      const key = `${projectId}:${id}`;
      const intents = resolveIntents.of(qc);
      const entry = intents.get(key) ?? { confirmed: undefined, pending: [] };
      if (entry.pending.length === 0) {
        entry.confirmed = qc
          .getQueriesData<Comment[]>(filter)
          .flatMap(([, comments]) => comments ?? [])
          .find((comment) => comment.id === id)?.resolved;
      }
      const token = resolveIntents.nextToken();
      entry.pending.push({ token, resolved });
      intents.set(key, entry);
      await qc.cancelQueries(filter);
      show(id, entry);
      return { token };
    },
    onSettled: (_data, error, { id, resolved }, context) => {
      const key = `${projectId}:${id}`;
      const intents = resolveIntents.of(qc);
      const entry = intents.get(key);
      if (entry && context) {
        entry.pending = entry.pending.filter((intent) => intent.token !== context.token);
        if (!error) entry.confirmed = resolved;
        // Only a failure can change what's shown: success confirms a value already on screen or overtaken by a newer click.
        if (error) show(id, entry);
        if (entry.pending.length === 0) intents.delete(key);
      }
      // A refetch while a later write is still queued would briefly show the older answer.
      return qc.isMutating({ mutationKey }) > 1 ? undefined : qc.invalidateQueries(filter);
    },
    meta: { errorMessage: (error) => friendlyErrorMessage(t, error, 'error.unexpected') },
  });
};

/**
 * Delete optimistically (the comment disappears at once); on failure only that
 * comment comes back, where it was, and the failure is reported (from `meta`,
 * so an earlier failure isn't lost when another delete started meanwhile).
 */
export const useDeleteComment = (projectId: string) => {
  const qc = useQueryClient();
  const t = useT();
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
    meta: { errorMessage: (error) => friendlyErrorMessage(t, error, 'editor.comments.deleteError') },
  });
};

// ─── AI drafting assistant ───────────────────────────────────────────────────

export const useAiDraft = (projectId: string) => {
  const t = useT();
  return useMutation({
    mutationFn: async (body: AiDraftBody) =>
      mutateData(await api.app.projects[':projectId'].ai.$post({ param: { projectId }, json: body }), 'Could not draft content.'),
    // 429 is the workspace's daily AI limit.
    meta: {
      errorMessage: (error) => {
        if (error instanceof ApiResponseError) {
          if (error.code === 'ai:not_configured') return t('editor.ai.notConfigured');
          if (error.code === 'ai:disabled') return t(error.reason === 'instance_disabled' ? 'editor.ai.instanceDisabled' : 'editor.ai.disabled');
        }
        return friendlyErrorMessage(t, error, 'editor.ai.draftError', { 429: 'editor.ai.rateLimited', 503: 'editor.ai.unavailable' });
      },
    },
  });
};

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

/** Promote a version. Pass `{ id, confirmPreview: preview.fingerprint }` after showing
 *  the pages changed on main; without it, a changed main fails with
 *  `branch:main_changed` (details: BranchMergePreview). */
export const useMergeBranch = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | { id: string; confirmPreview?: string }) => {
      const { id, confirmPreview } = typeof input === 'string' ? { id: input, confirmPreview: undefined } : input;
      return mutateData(
        await api.app.projects[':projectId'].branches[':id'].merge.$post({
          param: { projectId, id },
          json: confirmPreview ? { confirmPreview } : {},
        }),
        'Could not merge the branch.',
      );
    },
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
  fidelityIssues?: Array<{ kind: 'embed' | 'link'; page: string; reference: string }>;
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

/** Mark-read writes still waiting for the server (see `overlappingWrites`). */
interface MarkReadState {
  /** Rows shown read only because of writes in flight: which writes claim each row, and the time shown for it. */
  claims: Map<string, { tokens: Set<number>; readAt: string | null }>;
  /** Rows a finished write made read: a later failure must not show them unread again. */
  confirmed: Set<string>;
}
const markReads = overlappingWrites<MarkReadState>(() => ({ claims: new Map(), confirmed: new Set() }));

/**
 * Mark notifications read — pass `{ ids }` for specific rows or `{ all: true }`.
 * Optimistic (marking read always succeeds unless the request fails): the rows
 * and the bell's count change at once.
 *
 * Several writes can overlap (a row, then another, then "Mark all read"), so a
 * failure never restores an old copy of the inbox: it shows unread again only
 * the rows that no other write still in flight covers and no finished write
 * made read.
 *
 * The count is never rolled back. The bell polls it on its own, so while writes
 * are in flight the cached count may already be the server's answer, and that
 * answer may or may not include a write that has not answered yet: an inverse
 * change could be wrong either way. Instead, once the last write has finished,
 * the inbox and the count are refetched, so the badge is the server's own number.
 * After a failure the badge may read low until then.
 */
export const useMarkNotificationsRead = () => {
  const qc = useQueryClient();
  const t = useT();
  const mutationKey = ['notifications', 'markRead'];
  const listKey = queryKeys.notifications.list();
  const countKey = queryKeys.notifications.unreadCount();
  return useMutation({
    mutationKey,
    mutationFn: async (body: MarkNotificationsReadBody) =>
      mutateData(await api.app.notifications.read.$post({ json: body }), 'Could not update notifications.'),
    onMutate: async (body) => {
      await Promise.all([qc.cancelQueries({ queryKey: listKey, exact: true }), qc.cancelQueries({ queryKey: countKey, exact: true })]);
      const state = markReads.of(qc);
      const token = markReads.nextToken();
      const list = qc.getQueryData<NotificationList>(listKey);
      const readAt = new Date().toISOString();
      const targets = body.all ? null : new Set(body.ids ?? []);
      const claimed: string[] = [];
      let newlyRead = 0;
      const claim = (id: string, unread: boolean, shownReadAt: string | null) => {
        let entry = state.claims.get(id);
        if (!entry) {
          if (!unread) return;
          entry = { tokens: new Set(), readAt: shownReadAt };
          state.claims.set(id, entry);
          newlyRead += 1;
        }
        entry.tokens.add(token);
        claimed.push(id);
      };
      const listed = new Set<string>();
      for (const item of list?.items ?? []) {
        listed.add(item.id);
        if (targets === null || targets.has(item.id)) claim(item.id, item.readAt === null, readAt);
      }
      // Rows not in the loaded inbox are assumed unread, so the count never stays too high.
      for (const id of targets ?? []) if (!listed.has(id)) claim(id, true, null);
      if (list) {
        qc.setQueryData<NotificationList>(listKey, {
          ...list,
          items: list.items.map((item) => (item.readAt === null && state.claims.has(item.id) ? { ...item, readAt } : item)),
        });
      }
      qc.setQueryData<{ count: number }>(countKey, (current) =>
        current ? { ...current, count: targets === null ? 0 : Math.max(0, current.count - newlyRead) } : current,
      );
      return { token, claimed };
    },
    onSettled: (_data, error, _body, context) => {
      const state = markReads.peek(qc);
      if (state && context) {
        // Rows this write was the last to claim, with the time shown for them (null: not in the loaded inbox).
        const released = new Map<string, string | null>();
        for (const id of context.claimed) {
          const claim = state.claims.get(id);
          if (!claim) continue;
          claim.tokens.delete(context.token);
          if (!error) state.confirmed.add(id);
          if (claim.tokens.size > 0) continue;
          state.claims.delete(id);
          if (error && !state.confirmed.has(id)) released.set(id, claim.readAt);
        }
        const list = qc.getQueryData<NotificationList>(listKey);
        // A row refetched meanwhile shows the server's answer, so only rows still showing our time go back to unread.
        const restore = new Set(list?.items.filter((item) => released.has(item.id) && item.readAt === released.get(item.id)).map((item) => item.id));
        if (list && restore.size > 0) {
          qc.setQueryData<NotificationList>(listKey, {
            ...list,
            items: list.items.map((item) => (restore.has(item.id) ? { ...item, readAt: null } : item)),
          });
        }
      }
      // A refetch while another write is still in flight would briefly show the older answer.
      if (qc.isMutating({ mutationKey }) > 1) return;
      markReads.drop(qc);
      void qc.invalidateQueries({ queryKey: listKey, exact: true });
      // "This organization" inbox views are separate lists; they refetch rather than guess.
      void qc.invalidateQueries({ queryKey: ['notifications', 'organization'] });
      void qc.invalidateQueries({ queryKey: countKey, exact: true });
    },
    meta: { errorMessage: t('notifications.markReadError') },
  });
};
