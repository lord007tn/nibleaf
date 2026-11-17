import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useLocale } from '@nibleaf/i18n/react';
import { Archive, Ban, Download } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { FailureMessage } from '@/components/failure-message';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { formatExportFileSize } from '@/lib/export-file-size';
import { countVariables } from '@/lib/format';
import { useCancelExportRun, useExportArtifactLink, usePendingRunRequests } from '../api/runs';
import { type ExportArtifactRequest, type ExportRunSource, exportRunRow } from '../model/export-runs';
import { formatExportDate } from './schedule-row';

/** Hands one file to the browser's download through a native link, which is always removed again. */
function saveFile({ fileUrl, fileName }: { fileUrl: string; fileName: string }) {
  const link = document.createElement('a');
  link.href = fileUrl;
  link.download = fileName;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
}

/**
 * One run in the export history: its formats, status, published version,
 * where it came from, its failure, Cancel while it is queued or running (for
 * people who may start exports), and a download for each artifact.
 *
 * Cancel is server-confirmed: the status shown is the server's until it
 * answers, and its site's runs are read again whatever the answer.
 *
 * A request belongs to the site and run it was sent for. A download that was
 * asked for still starts after the person leaves, since they asked for that
 * file. A failure is reported only while the row still shows the view it
 * started in; nothing ever moves focus.
 */
export function ExportRunRow({ projectId, run, canCreate }: { projectId: string; run: ExportRunSource; canCreate: boolean }) {
  const { locale, t } = useLocale();
  const cancelRun = useCancelExportRun();
  const artifactLink = useExportArtifactLink();
  const row = exportRunRow(projectId, run, { canCreate, pending: usePendingRunRequests() });
  // Each site and run the row shows is a new view, even one it showed before (A → B → A); null once it is gone.
  const view = useRef<object | null>(null);
  useEffect(() => {
    const current = { projectId, runId: run.id };
    view.current = current;
    return () => {
      if (view.current === current) view.current = null;
    };
  }, [projectId, run.id]);

  const report = (startedIn: object | null, message: () => string) => {
    if (startedIn && view.current === startedIn) toast.error(message());
  };
  const cancel = async () => {
    if (!row.cancel) return;
    const startedIn = view.current;
    try {
      await cancelRun(row.cancel.request);
    } catch (error) {
      // 409: the run had already ended. The row reads it back, so "refresh and try again" would mislead.
      report(startedIn, () =>
        friendlyErrorMessage(t, error, 'settings.exports.workflow.cancelError', { 409: 'settings.exports.workflow.cancelError' }),
      );
    }
  };
  const download = async (request: ExportArtifactRequest) => {
    const startedIn = view.current;
    try {
      const file = await artifactLink(request);
      if (file !== 'busy') saveFile(file);
    } catch (error) {
      report(startedIn, () => friendlyErrorMessage(t, error, 'settings.exports.workflow.downloadError'));
    }
  };

  const formats = row.formats.map((format) => t(format)).join(', ');
  const createdAt = formatExportDate(run.createdAt, locale);
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-medium text-sm">
            <Archive aria-hidden className="size-4" />
            {formats} <Badge variant={row.status.variant}>{t(row.status.label)}</Badge>
          </div>
          <div className="mt-1 text-muted-foreground text-xs">
            {t('settings.exports.workflow.publishedVersion', { version: run.snapshot.deploymentVersion })} ·{' '}
            {t('settings.exports.workflow.pageCount', countVariables(locale, run.snapshot.pagesCount))} ·{' '}
            {'name' in row.trigger ? <span dir="auto">{row.trigger.name}</span> : t(row.trigger.label)} · <bdi>{createdAt}</bdi>
          </div>
        </div>
        {row.cancel ? (
          // Busy keeps focus on the button (focusableWhenDisabled), so a keyboard press doesn't drop it to the page.
          <Button focusableWhenDisabled loading={row.cancel.busy} onClick={() => void cancel()} size="sm" variant="outline">
            <Ban aria-hidden className="size-3.5" /> {t('common.cancel')}
            {/* The run's formats and time complete the accessible name, so two runs' buttons can be told apart. */}
            <span className="sr-only">
              {' '}
              {formats} <bdi>{createdAt}</bdi>
            </span>
          </Button>
        ) : null}
      </div>
      {run.error ? (
        <div className="mt-3 min-w-0 rounded-md bg-destructive/10 p-2">
          <p className="text-muted-foreground text-xs">{t('settings.exports.workflow.attempt', { count: run.attempts })}</p>
          <FailureMessage context="export" error={run.error} />
        </div>
      ) : null}
      {row.artifacts.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {row.artifacts.map((artifact) => (
            <Button
              focusableWhenDisabled
              key={artifact.id}
              loading={artifact.busy}
              onClick={() => void download(artifact.request)}
              size="sm"
              variant="outline"
            >
              <Download aria-hidden className="size-3.5" /> {t(artifact.format)} · <bdi>{formatExportFileSize(artifact.size, locale)}</bdi>
              <span className="sr-only">
                {' '}
                <bdi>{createdAt}</bdi>
              </span>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
