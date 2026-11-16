/**
 * One-time exports and their run history, as pure logic: whether a person may
 * start an export, which formats it asks for, and what one run in the history
 * says and offers. Rendered by `components/export-run-row.tsx` and the exports
 * section; tested in `export-runs.test.ts`.
 *
 * The server stays the authority. A run shows its status as last read; an
 * action is busy only while a request for this site and this run (or artifact)
 * is pending, so one row's request never locks another row or a schedule.
 */
import type { MessageKey } from '@nibleaf/i18n';
import type { ExportFormatInput as ExportFormat } from '@nibleaf/validators';
import { EXPORT_FORMAT_LABELS } from './schedule-create';

/** A run's status as the server reports it. */
type ExportStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

/** A one-time export of a site. It names the site it was sent for, whatever the page shows by the time it settles. */
export type ExportCreateRequest = { projectId: string; formats: ExportFormat[] };
/** A request about one run of a site (Cancel). */
export type ExportRunRequest = { projectId: string; runId: string };
/** A request for one artifact of a run (its download link). */
export type ExportArtifactRequest = ExportRunRequest & { artifactId: string };

/**
 * Whether the site has a published version to export. The site's own flag
 * covers every publish however old; the deployments list (newest 50) catches a
 * first publish that finished after the site was loaded. Unknown (undefined)
 * until both say: unknown is not "never published".
 */
export const liveVersionKnown = (projectHasOne: boolean | undefined, recentReady: boolean | undefined): boolean | undefined => {
  if (projectHasOne || recentReady) return true;
  return projectHasOne === false && recentReady === false ? false : undefined;
};

/** Turns one format on or off. At least one stays on, and formats keep the order they were turned on in. */
export const toggleExportFormat = (current: readonly ExportFormat[], format: ExportFormat): ExportFormat[] => {
  if (!current.includes(format)) return [...current, format];
  return current.length === 1 ? [...current] : current.filter((item) => item !== format);
};

/**
 * The one-time export control. `unavailable` keeps the button in the tab order
 * with `hint` read as its reason: people who can't start exports, or a site
 * known to be unpublished. While the live version is unknown the export is
 * offered, and the server's answer explains a refusal.
 */
export function manualExport({ canCreate, hasLiveVersion }: { canCreate: boolean; hasLiveVersion: boolean | undefined }): {
  hint: MessageKey;
  unavailable: boolean;
} {
  if (!canCreate) return { hint: 'access.viewOnly.action', unavailable: true };
  if (hasLiveVersion === false) return { hint: 'settings.exports.workflow.publishFirst', unavailable: true };
  return { hint: 'settings.exports.workflow.formatHint', unavailable: false };
}

const field = (variables: unknown, name: string): unknown =>
  typeof variables === 'object' && variables !== null ? (variables as Record<string, unknown>)[name] : undefined;

/** Whether a pending request (as the mutation cache holds it) is for this site. */
export const isSiteRequest = (variables: unknown, projectId: string): boolean => field(variables, 'projectId') === projectId;
/** Whether a pending request is about this site's run. */
export const isRunRequest = (variables: unknown, { projectId, runId }: ExportRunRequest): boolean =>
  isSiteRequest(variables, projectId) && field(variables, 'runId') === runId;
/** Whether a pending request is for this site's run's artifact. */
export const isArtifactRequest = (variables: unknown, request: ExportArtifactRequest): boolean =>
  isRunRequest(variables, request) && field(variables, 'artifactId') === request.artifactId;

/** Queued or running: the history keeps polling, and the run can be cancelled. */
const isActiveRun = (status: ExportStatus): boolean => status === 'PENDING' || status === 'RUNNING';

const STATUS: Record<ExportStatus, { label: MessageKey; variant: 'default' | 'secondary' | 'destructive' }> = {
  PENDING: { label: 'settings.exports.workflow.status.pending', variant: 'secondary' },
  RUNNING: { label: 'settings.exports.workflow.status.running', variant: 'secondary' },
  SUCCEEDED: { label: 'settings.exports.workflow.status.succeeded', variant: 'default' },
  FAILED: { label: 'settings.exports.workflow.status.failed', variant: 'destructive' },
  CANCELLED: { label: 'settings.exports.workflow.status.cancelled', variant: 'secondary' },
};

/** The fields of a listed run that its row reads. */
export type ExportRunSource = {
  id: string;
  formats: ExportFormat[];
  status: ExportStatus;
  trigger: 'MANUAL' | 'SCHEDULED';
  attempts: number;
  error: string | null;
  createdAt: string;
  snapshot: { deploymentVersion: number; pagesCount: number };
  artifacts: { id: string; format: ExportFormat; size: number }[];
  schedule: { name: string } | null;
};

type ExportRunRowModel = {
  formats: MessageKey[];
  status: (typeof STATUS)[ExportStatus];
  /** The schedule's own name for a scheduled run, otherwise a label to translate. */
  trigger: { name: string } | { label: MessageKey };
  /** Null unless the run is queued or running and the person may start or cancel exports. */
  cancel: { request: ExportRunRequest; busy: boolean } | null;
  artifacts: { id: string; format: MessageKey; size: number; request: ExportArtifactRequest; busy: boolean }[];
};

/**
 * The row for one run. `pending` lists the cancellations and downloads in
 * flight for every row; only those for this site's run (or this artifact)
 * make an action busy.
 */
export function exportRunRow(
  projectId: string,
  run: ExportRunSource,
  { canCreate, pending }: { canCreate: boolean; pending: { cancel: readonly unknown[]; download: readonly unknown[] } },
): ExportRunRowModel {
  const runRequest: ExportRunRequest = { projectId, runId: run.id };
  return {
    formats: run.formats.map((format) => EXPORT_FORMAT_LABELS[format]),
    status: STATUS[run.status],
    trigger:
      run.trigger === 'SCHEDULED'
        ? run.schedule
          ? { name: run.schedule.name }
          : { label: 'settings.exports.workflow.scheduled' }
        : { label: 'settings.exports.workflow.manual' },
    cancel:
      canCreate && isActiveRun(run.status)
        ? { request: runRequest, busy: pending.cancel.some((variables) => isRunRequest(variables, runRequest)) }
        : null,
    artifacts: run.artifacts.map((artifact) => {
      const request: ExportArtifactRequest = { ...runRequest, artifactId: artifact.id };
      return {
        id: artifact.id,
        format: EXPORT_FORMAT_LABELS[artifact.format],
        size: artifact.size,
        request,
        busy: pending.download.some((variables) => isArtifactRequest(variables, request)),
      };
    }),
  };
}
