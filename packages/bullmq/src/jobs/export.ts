export type ExportJobName = 'render-export' | 'dispatch-export-schedules' | 'cleanup-exports';

export type ExportJobData = { exportJobId: string } | { requestedAt: string };
