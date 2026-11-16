import type { CreateExportScheduleBody } from '@nibleaf/validators';
import { mutateData } from '@/hooks/api/client-helpers';
import type { ExportSchedule } from '@/hooks/api/exports';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';

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
