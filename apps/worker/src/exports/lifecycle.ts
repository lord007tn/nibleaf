export interface RetainedRun {
  id: string;
  createdAt: Date;
}

/** Retention is the union of count and age policies: a run expires when it is
 * beyond the newest N terminal runs or older than the configured day limit. */
export const expiredRunIds = (runs: RetainedRun[], retentionCount: number, retentionDays: number, now = new Date()): string[] => {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  return [...runs]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .filter((run, index) => index >= retentionCount || run.createdAt.getTime() < cutoff)
    .map((run) => run.id);
};

/** BullMQ exposes attemptsMade before the current failure is recorded. */
export const isFinalExportAttempt = (attemptsMade: number, configuredAttempts: number | undefined): boolean =>
  attemptsMade + 1 >= (configuredAttempts ?? 1);
