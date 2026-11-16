import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { SkeletonCard } from '@nibleaf/design-system/components/ui/skeleton';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import type { MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { Archive, Ban, Download, FileArchive, Play, Plus } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FailureMessage } from '@/components/failure-message';
import { ScheduleCreateForm } from '@/features/site-exports/components/schedule-create-form';
import { EXPORT_FORMAT_LABELS as labelKeys } from '@/features/site-exports/model/schedule-create';
import { useDeployments, useProject } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import {
  type ExportArtifact,
  type ExportFormat,
  type ExportRun,
  type ExportSchedule,
  type ExportStatus,
  useCancelExport,
  useCreateExport,
  useGetExportDownload,
  useListExportRuns,
  useListExportSchedules,
  useRunExportSchedule,
  useUpdateExportSchedule,
} from '@/hooks/api/exports';
import { formatExportFileSize } from '@/lib/export-file-size';
import { countVariables, localeTag } from '@/lib/format';
import { SectionHeader, useConfirmSettingsDiscard } from './shared';

const formatDate = (date: string | null, locale: string) => (date ? new Date(date).toLocaleString(localeTag(locale)) : '—');

/**
 * What a failed export start means. 409: too many exports running, or today's
 * limit reached. 400 once a version is known to be live: that version is larger
 * than this instance exports (retrying won't help); otherwise the site was
 * never published.
 */
const startStatusKeys = (hasLiveVersion: boolean | undefined): Partial<Record<number, MessageKey>> => ({
  409: 'settings.exports.workflow.limitReached',
  400: hasLiveVersion ? 'settings.exports.workflow.tooLarge' : 'settings.exports.workflow.publishFirst',
});

/**
 * Whether the site has a published version to export. The site's own flag
 * covers every publish however old; the deployments list (newest 50) catches a
 * first publish that finished after the site was loaded. Unknown until both say.
 */
const liveVersionKnown = (projectHasOne: boolean | undefined, recentReady: boolean | undefined): boolean | undefined => {
  if (projectHasOne || recentReady) return true;
  return projectHasOne === false && recentReady === false ? false : undefined;
};

export function ExportsSection({
  projectId,
  canManageSchedules,
  canCreate = true,
}: {
  projectId: string;
  canManageSchedules: boolean;
  /** Viewers download finished exports; starting or cancelling one is for Editors. */
  canCreate?: boolean;
}) {
  const { locale, t } = useLocale();
  const [formats, setFormats] = useState<ExportFormat[]>(['MARKDOWN']);
  const [showSchedule, setShowSchedule] = useState(false);
  const [surface, setSurface] = useState<'create' | 'schedules' | 'history'>('create');
  // The new-schedule draft is unsettled while it differs from its defaults or its creation is pending.
  // Closing it or leaving Schedules asks first, as leaving the page does.
  const scheduleUnsettled = useRef(false);
  const setScheduleUnsettled = useCallback((unsettled: boolean) => {
    scheduleUnsettled.current = unsettled;
  }, []);
  const confirmDiscard = useConfirmSettingsDiscard();
  const mayCloseSchedule = async () => !scheduleUnsettled.current || (await confirmDiscard());
  const runs = useListExportRuns(projectId);
  const schedules = useListExportSchedules(projectId);
  const create = useCreateExport(projectId);
  const cancel = useCancelExport(projectId);
  const downloadMutation = useGetExportDownload(projectId);
  // Exports copy the live version, so a site that was never published has nothing to export yet.
  const project = useProject(projectId);
  const deployments = useDeployments(projectId);
  const hasLiveVersion = liveVersionKnown(
    project.data?.hasPublishedVersion,
    deployments.data ? deployments.data.some((deployment) => deployment.status === 'READY') : undefined,
  );
  const neverPublished = hasLiveVersion === false;
  const createHintId = useId();
  const downloadArtifact = async (run: ExportRun, artifact: ExportArtifact) => {
    try {
      const result = await downloadMutation.mutateAsync({ runId: run.id, artifactId: artifact.id });
      const link = document.createElement('a');
      link.href = result.fileUrl;
      link.download = result.fileName;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
    } catch (error) {
      toast.error(friendlyErrorMessage(t, error, 'settings.exports.workflow.downloadError'));
    }
  };
  const toggleFormat = (format: ExportFormat) =>
    setFormats((current) =>
      current.includes(format) ? (current.length === 1 ? current : current.filter((item) => item !== format)) : [...current, format],
    );

  return (
    <div className="space-y-7">
      <SectionHeader
        icon={<Archive className="size-4" />}
        title={t('settings.exports.title')}
        description={t('settings.exports.workflow.description')}
      />
      <nav aria-label={t('settings.exports.workflow.navLabel')} className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ['create', t('settings.exports.workflow.oneTime'), t('settings.exports.workflow.oneTimeDesc')],
            ['schedules', t('settings.exports.workflow.schedules'), t('settings.exports.workflow.schedulesDesc')],
            ['history', t('settings.exports.workflow.history'), t('settings.exports.workflow.historyDesc')],
          ] as const
        ).map(([value, title, description]) => (
          <Button
            aria-pressed={surface === value}
            className="h-auto flex-col items-start whitespace-normal p-3 text-start aria-pressed:border-primary aria-pressed:bg-primary/5"
            key={value}
            onClick={async () => {
              if (value !== surface && !(await mayCloseSchedule())) return;
              setSurface(value);
            }}
            type="button"
            variant="outline"
          >
            <span className="block font-medium text-sm">{title}</span>
            <span className="mt-1 block text-muted-foreground text-xs">{description}</span>
          </Button>
        ))}
      </nav>
      {runs.isError || schedules.isError ? (
        <div aria-live="polite" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm">
          {t('settings.exports.workflow.loadError')}
        </div>
      ) : null}
      {surface === 'create' ? (
        <section className="space-y-3">
          <div className="font-semibold text-sm">{t('settings.exports.workflow.create')}</div>
          <div className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap gap-3">
              {(Object.keys(labelKeys) as ExportFormat[]).map((format) => (
                <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm" key={format}>
                  <Switch checked={formats.includes(format)} id={`export-format-${format}`} onCheckedChange={() => toggleFormat(format)} />
                  <Label htmlFor={`export-format-${format}`}>{t(labelKeys[format])}</Label>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs" id={createHintId}>
                {!canCreate
                  ? t('access.viewOnly.action')
                  : neverPublished
                    ? t('settings.exports.workflow.publishFirst')
                    : t('settings.exports.workflow.formatHint')}
              </p>
              {/* Unavailable, not `disabled`: it stays in the tab order, and its reason (the hint) is read with it.
                  It looks like a disabled button too: dimmed, and no hover darkening or press movement. */}
              <Button
                aria-describedby={neverPublished || !canCreate ? createHintId : undefined}
                aria-disabled={neverPublished || !canCreate || undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-primary aria-disabled:active:not-aria-[haspopup]:translate-y-0"
                loading={create.isPending}
                onClick={() => {
                  if (neverPublished || !canCreate) return;
                  create.mutate(formats, {
                    onSuccess: () => toast.success(t('settings.exports.workflow.queued')),
                    onError: (error) =>
                      toast.error(friendlyErrorMessage(t, error, 'settings.exports.workflow.startError', startStatusKeys(hasLiveVersion))),
                  });
                }}
              >
                <FileArchive className="size-3.5" /> {t('settings.exports.workflow.create')}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {surface === 'schedules' ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-sm">{t('settings.exports.workflow.archiveSchedules')}</div>
            {canManageSchedules ? (
              <Button
                aria-expanded={showSchedule}
                onClick={async () => {
                  if (showSchedule && !(await mayCloseSchedule())) return;
                  setShowSchedule(!showSchedule);
                }}
                size="sm"
                variant="outline"
              >
                <Plus className="size-3.5" /> {t('settings.exports.workflow.newSchedule')}
              </Button>
            ) : null}
          </div>
          {showSchedule && canManageSchedules ? (
            <ScheduleCreateForm onCreated={() => setShowSchedule(false)} onUnsettledChange={setScheduleUnsettled} projectId={projectId} />
          ) : null}
          <div className="space-y-2">
            {schedules.isPending ? (
              <div aria-busy="true">
                <p className="sr-only" role="status">
                  {t('common.loading')}
                </p>
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : null}
            {schedules.data?.map((schedule) => (
              <ScheduleRow
                canManage={canManageSchedules}
                hasLiveVersion={hasLiveVersion}
                key={schedule.id}
                projectId={projectId}
                schedule={schedule}
              />
            ))}
            {!schedules.isPending && !schedules.data?.length ? (
              <div className="rounded-lg border border-dashed p-5 text-center">
                <Archive className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2 font-medium text-sm">{t('settings.exports.workflow.noSchedules')}</p>
                <p className="mt-1 text-muted-foreground text-xs">{t('settings.exports.workflow.noSchedulesDesc')}</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {surface === 'history' ? (
        <section className="space-y-3">
          <div className="font-semibold text-sm">{t('settings.exports.workflow.history')}</div>
          <div className="space-y-2">
            {runs.isPending ? (
              <div aria-busy="true">
                <p className="sr-only" role="status">
                  {t('common.loading')}
                </p>
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : null}
            {runs.data?.map((run) => (
              <div className="rounded-lg border border-border p-4" key={run.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-medium text-sm">
                      <Archive className="size-4" />
                      {run.formats.map((format) => t(labelKeys[format])).join(', ')} <StatusBadge status={run.status} />
                    </div>
                    <div className="mt-1 text-muted-foreground text-xs">
                      {t('settings.exports.workflow.publishedVersion', { version: run.snapshot.deploymentVersion })} ·{' '}
                      {t('settings.exports.workflow.pageCount', countVariables(locale, run.snapshot.pagesCount))} ·{' '}
                      {run.trigger === 'SCHEDULED'
                        ? (run.schedule?.name ?? t('settings.exports.workflow.scheduled'))
                        : t('settings.exports.workflow.manual')}{' '}
                      · {formatDate(run.createdAt, locale)}
                    </div>
                  </div>
                  {(run.status === 'PENDING' || run.status === 'RUNNING') && canCreate ? (
                    <Button
                      loading={cancel.isPending && cancel.variables === run.id}
                      onClick={() => cancel.mutate(run.id)}
                      size="sm"
                      variant="outline"
                    >
                      <Ban className="size-3.5" /> {t('common.cancel')}
                    </Button>
                  ) : null}
                </div>
                {run.error ? (
                  <div className="mt-3 min-w-0 rounded-md bg-destructive/10 p-2">
                    <p className="text-muted-foreground text-xs">{t('settings.exports.workflow.attempt', { count: run.attempts })}</p>
                    <FailureMessage context="export" error={run.error} />
                  </div>
                ) : null}
                {run.artifacts.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {run.artifacts.map((artifact) => (
                      <Button
                        loading={downloadMutation.isPending && downloadMutation.variables?.artifactId === artifact.id}
                        key={artifact.id}
                        onClick={() => downloadArtifact(run, artifact)}
                        size="sm"
                        variant="outline"
                      >
                        <Download className="size-3.5" /> {t(labelKeys[artifact.format])} · {formatExportFileSize(artifact.size, locale)}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {!runs.isPending && !runs.data?.length ? (
              <div className="rounded-lg border border-dashed p-5 text-center">
                <FileArchive className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2 font-medium text-sm">{t('settings.exports.workflow.noRuns')}</p>
                <p className="mt-1 text-muted-foreground text-xs">{t('settings.exports.workflow.noRunsDesc')}</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {surface === 'create' ? (
        <p className="text-muted-foreground text-xs">
          {t('settings.exports.workflow.legacyPrompt')}{' '}
          <a className="underline" download href={`/api/app/projects/${projectId}/export`}>
            {t('settings.exports.workflow.legacyDownload')}
          </a>
          {' · '}
          <a className="underline" download href={`/api/app/projects/${projectId}/theme-repository`}>
            {t('settings.exports.downloadRepository')}
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: ExportStatus }) {
  const { t } = useLocale();
  return (
    <Badge variant={status === 'FAILED' ? 'destructive' : status === 'SUCCEEDED' ? 'default' : 'secondary'}>
      {t(`settings.exports.workflow.status.${status.toLowerCase()}` as MessageKey)}
    </Badge>
  );
}

function ScheduleRow({
  projectId,
  schedule,
  canManage,
  hasLiveVersion,
}: {
  projectId: string;
  schedule: ExportSchedule;
  canManage: boolean;
  hasLiveVersion: boolean | undefined;
}) {
  const { locale, t } = useLocale();
  const update = useUpdateExportSchedule(projectId, schedule.id);
  const run = useRunExportSchedule(projectId, schedule.id);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium text-sm">
          <span dir="auto">{schedule.name}</span>
          <Badge variant="secondary">{schedule.enabled ? t('settings.exports.workflow.enabled') : t('settings.exports.workflow.disabled')}</Badge>
        </div>
        <div className="mt-1 text-muted-foreground text-xs">
          {t(`settings.exports.workflow.${schedule.cadence.toLowerCase()}` as MessageKey)} {t('settings.exports.workflow.at')}{' '}
          <span dir="ltr">
            {String(schedule.hour).padStart(2, '0')}:{String(schedule.minute).padStart(2, '0')} {schedule.timezone}
          </span>{' '}
          · {t('settings.exports.workflow.next')} {formatDate(schedule.nextRunAt, locale)} ·{' '}
          {t('settings.exports.workflow.runCount', { count: schedule._count.jobs })}
        </div>
        {schedule.lastError ? <FailureMessage context="export" error={schedule.lastError} /> : null}
      </div>
      {canManage ? (
        <div className="flex gap-2">
          <Button
            loading={run.isPending}
            onClick={() =>
              run.mutate(undefined, {
                onSuccess: () => toast.success(t('settings.exports.workflow.runQueued')),
                onError: (error) =>
                  toast.error(friendlyErrorMessage(t, error, 'settings.exports.workflow.startError', startStatusKeys(hasLiveVersion))),
              })
            }
            size="sm"
            variant="outline"
          >
            <Play className="size-3.5" /> {t('settings.exports.workflow.runNow')}
          </Button>
          <Button
            loading={update.isPending}
            onClick={() =>
              update.mutate({ enabled: !schedule.enabled }, { onError: (error) => toast.error(friendlyErrorMessage(t, error, 'settings.saveError')) })
            }
            size="sm"
            variant="outline"
          >
            {schedule.enabled ? t('settings.exports.workflow.disable') : t('settings.exports.workflow.enable')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
