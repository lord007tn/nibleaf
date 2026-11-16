import type { CreateExportScheduleBody } from '@nibleaf/validators';
import { type MutationKey, useMutationState } from '@tanstack/react-query';
import { mutateData } from '@/hooks/api/client-helpers';
import type { ExportRun, ExportSchedule } from '@/hooks/api/exports';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { isScheduleRequest, type ScheduleEnabledRequest, type ScheduleRequest } from '../model/schedule-row';

/**
 * Creates one export schedule and resolves with the server's schedule.
 *
 * The site travels with each request, not with the hook: TanStack hands a
 * pending mutation the options of every later render, so a hook bound to the
 * current site would refresh the wrong site's lists after a switch. The
 * refresh of the request's own site is awaited but can't fail the creation
 * (invalidation doesn't throw on a failed refetch), and nothing is retried.
 */
export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, body }: { projectId: string; body: CreateExportScheduleBody }) =>
      mutateData<ExportSchedule>(
        await api.app.projects[':projectId'].exports.schedules.$post({ param: { projectId }, json: body }),
        'Could not create the export schedule.',
      ),
    onSuccess: (_schedule, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.exports.all(projectId) }),
  }).mutateAsync;
}

// Fixed keys: a key built from the rendered site would be rewritten on a pending request by
// a later render. Each request's own variables say which site and schedule it is about.
const ENABLED_KEY: MutationKey = ['export-schedule', 'enabled'];
const RUN_KEY: MutationKey = ['export-schedule', 'run'];

/** Requests of one kind still in flight, as the variables they were sent with. */
const usePendingRequests = (mutationKey: MutationKey) =>
  useMutationState({ filters: { mutationKey, status: 'pending' }, select: (mutation) => mutation.state.variables });

/** Every Run now and Enable/Disable request in flight on the page, for `scheduleRow` to match against its own schedule. */
export const usePendingScheduleRequests = () => ({ run: usePendingRequests(RUN_KEY), enabled: usePendingRequests(ENABLED_KEY) });

/**
 * Server-confirmed: turns one schedule on or off, sending only `enabled`.
 * Nothing changes on screen before the server answers, so a failure has
 * nothing to undo. Success or failure, the request's own site is read again,
 * so after a failure the row shows the server's value. While a request for
 * that site's schedule is pending, another is not sent and `'busy'` is
 * returned.
 */
export function useSetScheduleEnabled() {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: ENABLED_KEY,
    mutationFn: async ({ projectId, scheduleId, enabled }: ScheduleEnabledRequest) =>
      mutateData<ExportSchedule>(
        await api.app.projects[':projectId'].exports.schedules[':scheduleId'].$patch({ param: { projectId, scheduleId }, json: { enabled } }),
        'Could not update the export schedule.',
      ),
    onSettled: (_schedule, _error, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.exports.all(projectId) }),
  });
  return async (request: ScheduleEnabledRequest) => (pendingFor(queryClient, ENABLED_KEY, request) ? 'busy' : mutateAsync(request));
}

/**
 * Server-confirmed: queues one run of a schedule now, with no body. A
 * success refreshes the request's own site's exports. While a run of that
 * site's schedule is pending, another is not sent and `'busy'` is returned.
 */
export function useRunSchedule() {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: RUN_KEY,
    mutationFn: async ({ projectId, scheduleId }: ScheduleRequest) =>
      mutateData<ExportRun>(
        await api.app.projects[':projectId'].exports.schedules[':scheduleId'].run.$post({ param: { projectId, scheduleId } }),
        'Could not run the export schedule.',
      ),
    onSuccess: (_run, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.exports.all(projectId) }),
  });
  return async (request: ScheduleRequest) => (pendingFor(queryClient, RUN_KEY, request) ? 'busy' : mutateAsync(request));
}

/** Read before sending: a request becomes pending in the cache as it is sent, so a second press in the same tick sees it. */
const pendingFor = (queryClient: ReturnType<typeof useQueryClient>, mutationKey: MutationKey, request: ScheduleRequest) =>
  queryClient.isMutating({ mutationKey, predicate: (mutation) => isScheduleRequest(mutation.state.variables, request) }) > 0;
