import type { ExportFormatInput } from '@nibleaf/validators';
import { useQuery } from '@tanstack/react-query';
import { listExportRunsQueryOptions, listExportSchedulesQueryOptions } from './query-options';

export type ExportFormat = ExportFormatInput;
export type ExportStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

interface ExportArtifact {
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

/** Export history. Polls while a run is queued or running so its status updates on its own. */
export const useListExportRuns = (projectId: string) =>
  useQuery({
    ...listExportRunsQueryOptions(projectId),
    refetchInterval: (query) => (query.state.data?.some((run) => run.status === 'PENDING' || run.status === 'RUNNING') ? 2500 : false),
  });

export const useListExportSchedules = (projectId: string) => useQuery(listExportSchedulesQueryOptions(projectId));
