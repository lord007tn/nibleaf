import type { CreateExportScheduleBody, ExportFormatInput, UpdateExportScheduleBody } from '@nibleaf/validators';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';
import { queryKeys } from './query-keys';

export type ExportFormat = ExportFormatInput;
export type ExportStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface ExportArtifact {
  id: string;
  format: ExportFormat;
  fileName: string;
  size: number;
}

export interface ExportRun {
  id: string;
  formats: ExportFormat[];
  status: ExportStatus;
  trigger: 'MANUAL' | 'SCHEDULED';
  attempts: number;
  error: string | null;
  createdAt: string;
  snapshot: { deploymentVersion: number; pagesCount: number; createdAt: string };
  artifacts: ExportArtifact[];
  schedule: { id: string; name: string } | null;
}

export interface ExportSchedule {
  id: string;
  name: string;
  formats: ExportFormat[];
  cadence: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  timezone: string;
  hour: number;
  minute: number;
  enabled: boolean;
  nextRunAt: string | null;
  lastError: string | null;
  retentionCount: number;
  retentionDays: number;
  _count: { jobs: number };
}

const invalidateExports = (queryClient: QueryClient, projectId: string) =>
  queryClient.invalidateQueries({ queryKey: queryKeys.exports.all(projectId) });

export const useListExportRuns = (projectId: string) =>
  useQuery({
    queryKey: queryKeys.exports.runs(projectId),
    queryFn: async () => getData<ExportRun[]>(await api.app.projects[':projectId'].exports.$get({ param: { projectId } }), 'export runs'),
    refetchInterval: (query) => (query.state.data?.some((run) => run.status === 'PENDING' || run.status === 'RUNNING') ? 2500 : false),
  });

export const useListExportSchedules = (projectId: string) =>
  useQuery({
    queryKey: queryKeys.exports.schedules(projectId),
    queryFn: async () =>
      getData<ExportSchedule[]>(await api.app.projects[':projectId'].exports.schedules.$get({ param: { projectId } }), 'export schedules'),
  });

export const useCreateExport = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (formats: ExportFormat[]) =>
      mutateData<ExportRun>(
        await api.app.projects[':projectId'].exports.$post({ param: { projectId }, json: { formats } }),
        'Could not queue the export.',
      ),
    onSuccess: () => invalidateExports(queryClient, projectId),
  });
};

export const useCancelExport = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData<ExportRun>(
        await api.app.projects[':projectId'].exports[':id'].cancel.$post({ param: { projectId, id } }),
        'Could not cancel the export.',
      ),
    onSuccess: () => invalidateExports(queryClient, projectId),
  });
};

export const useGetExportDownload = (projectId: string) =>
  useMutation({
    mutationFn: async ({ runId, artifactId }: { runId: string; artifactId: string }) =>
      getData(
        await api.app.projects[':projectId'].exports[':id'].artifacts[':artifactId'].download.$get({
          param: { projectId, id: runId, artifactId },
        }),
        'download URL',
      ),
  });

export const useCreateExportSchedule = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateExportScheduleBody) =>
      mutateData<ExportSchedule>(
        await api.app.projects[':projectId'].exports.schedules.$post({ param: { projectId }, json: body }),
        'Could not create the export schedule.',
      ),
    onSuccess: () => invalidateExports(queryClient, projectId),
  });
};

export const useUpdateExportSchedule = (projectId: string, scheduleId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateExportScheduleBody) =>
      mutateData<ExportSchedule>(
        await api.app.projects[':projectId'].exports.schedules[':scheduleId'].$patch({ param: { projectId, scheduleId }, json: body }),
        'Could not update the export schedule.',
      ),
    onSuccess: () => invalidateExports(queryClient, projectId),
  });
};

export const useRunExportSchedule = (projectId: string, scheduleId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      mutateData<ExportRun>(
        await api.app.projects[':projectId'].exports.schedules[':scheduleId'].run.$post({ param: { projectId, scheduleId } }),
        'Could not run the export schedule.',
      ),
    onSuccess: () => invalidateExports(queryClient, projectId),
  });
};
