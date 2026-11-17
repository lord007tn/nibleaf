import { type MutationKey, useMutationState } from '@tanstack/react-query';
import { getData, mutateData } from '@/hooks/api/client-helpers';
import type { ExportRun } from '@/hooks/api/exports';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import {
  type ExportArtifactRequest,
  type ExportCreateRequest,
  type ExportRunRequest,
  isArtifactRequest,
  isRunRequest,
  isSiteRequest,
} from '../model/export-runs';

// Fixed keys: a key built from the rendered site would be rewritten on a pending request by a
// later render. Each request's own variables say which site, run and artifact it is about.
const CREATE_KEY: MutationKey = ['export-run', 'create'];
const CANCEL_KEY: MutationKey = ['export-run', 'cancel'];
const DOWNLOAD_KEY: MutationKey = ['export-run', 'download'];

type QueryClient = ReturnType<typeof useQueryClient>;

/** Read before sending: a request becomes pending in the cache as it is sent, so a second press in the same tick sees it. */
const isPending = (queryClient: QueryClient, mutationKey: MutationKey, matches: (variables: unknown) => boolean) =>
  queryClient.isMutating({ mutationKey, predicate: (mutation) => matches(mutation.state.variables) }) > 0;

/** Requests of one kind still in flight, as the variables they were sent with. */
const usePendingRequests = (mutationKey: MutationKey) =>
  useMutationState({ filters: { mutationKey, status: 'pending' }, select: (mutation) => mutation.state.variables });

/** Every one-time export, Cancel and download in flight on the page, for each control to match against its own site, run or artifact. */
export const usePendingRunRequests = () => ({
  create: usePendingRequests(CREATE_KEY),
  cancel: usePendingRequests(CANCEL_KEY),
  download: usePendingRequests(DOWNLOAD_KEY),
});

/**
 * Queues a one-time export of the request's site with the formats it names
 * (the body is only `{ formats }`). A success refreshes that site's exports,
 * whatever site the page shows by then. While an export of that site is
 * pending, another is not sent and `'busy'` is returned.
 */
export function useCreateExportRun() {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: CREATE_KEY,
    mutationFn: async ({ projectId, formats }: ExportCreateRequest) =>
      mutateData<ExportRun>(
        await api.app.projects[':projectId'].exports.$post({ param: { projectId }, json: { formats } }),
        'Could not queue the export.',
      ),
    onSuccess: (_run, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.exports.all(projectId) }),
  });
  return async (request: ExportCreateRequest) =>
    isPending(queryClient, CREATE_KEY, (variables) => isSiteRequest(variables, request.projectId)) ? 'busy' : mutateAsync(request);
}

/**
 * Server-confirmed: asks the server to cancel one run. Nothing changes on
 * screen before it answers, so a failure has nothing to undo. Success or
 * failure, the request's own site is read again, so the row shows the
 * server's status. While a cancellation of that run is pending, another is
 * not sent and `'busy'` is returned.
 */
export function useCancelExportRun() {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: CANCEL_KEY,
    mutationFn: async ({ projectId, runId }: ExportRunRequest) =>
      mutateData<ExportRun>(
        await api.app.projects[':projectId'].exports[':id'].cancel.$post({ param: { projectId, id: runId } }),
        'Could not cancel the export.',
      ),
    onSettled: (_run, _error, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.exports.all(projectId) }),
  });
  return async (request: ExportRunRequest) =>
    isPending(queryClient, CANCEL_KEY, (variables) => isRunRequest(variables, request)) ? 'busy' : mutateAsync(request);
}

/**
 * Asks for the download link of one artifact of the request's site. It
 * changes nothing on the server, so nothing is refreshed. While a link for
 * that artifact is pending, another is not asked for and `'busy'` is returned.
 */
export function useExportArtifactLink() {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: DOWNLOAD_KEY,
    mutationFn: async ({ projectId, runId, artifactId }: ExportArtifactRequest) =>
      getData(
        await api.app.projects[':projectId'].exports[':id'].artifacts[':artifactId'].download.$get({
          param: { projectId, id: runId, artifactId },
        }),
        'download URL',
      ),
  });
  return async (request: ExportArtifactRequest) =>
    isPending(queryClient, DOWNLOAD_KEY, (variables) => isArtifactRequest(variables, request)) ? 'busy' : mutateAsync(request);
}
