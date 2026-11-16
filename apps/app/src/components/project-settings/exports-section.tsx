import { Button } from '@nibleaf/design-system/components/ui/button';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { SkeletonCard } from '@nibleaf/design-system/components/ui/skeleton';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { useLocale } from '@nibleaf/i18n/react';
import { Archive, FileArchive, Plus } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useCreateExportRun, usePendingRunRequests } from '@/features/site-exports/api/runs';
import { ExportRunRow } from '@/features/site-exports/components/export-run-row';
import { ScheduleCreateForm } from '@/features/site-exports/components/schedule-create-form';
import { ScheduleRow } from '@/features/site-exports/components/schedule-row';
import { isSiteRequest, liveVersionKnown, manualExport, toggleExportFormat } from '@/features/site-exports/model/export-runs';
import { EXPORT_FORMAT_LABELS as labelKeys } from '@/features/site-exports/model/schedule-create';
import { exportStartErrorKeys } from '@/features/site-exports/model/schedule-row';
import { useDeployments, useProject } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { type ExportFormat, useListExportRuns, useListExportSchedules } from '@/hooks/api/exports';
import { SectionHeader, useConfirmSettingsDiscard } from './shared';

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
  const { t } = useLocale();
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
  // Which draft a leave confirmation is about. It moves on whenever the form opens or closes (a
  // creation closes it too), the surface changes, or the form starts or ends a draft itself (it
  // mounts, unmounts or moves to another site), so an answer that arrives later can't drop another draft.
  const scheduleDraft = useRef(0);
  const nextScheduleDraft = useCallback(() => {
    scheduleDraft.current += 1;
  }, []);
  const showScheduleDraft = (open: boolean) => {
    nextScheduleDraft();
    setShowSchedule(open);
  };
  /**
   * Runs `action` once the draft may be dropped: nothing unsettled, or a confirmed discard of
   * the draft that was open when asked. Accepting moves to a new draft in the same step, so a
   * second answer about the same draft does nothing.
   */
  const leaveScheduleDraft = async (action: () => void) => {
    const draft = scheduleDraft.current;
    if (scheduleUnsettled.current && !(await confirmDiscard())) return;
    if (draft !== scheduleDraft.current) return;
    nextScheduleDraft();
    action();
  };
  const runs = useListExportRuns(projectId);
  const schedules = useListExportSchedules(projectId);
  const createRun = useCreateExportRun();
  const creating = usePendingRunRequests().create.some((variables) => isSiteRequest(variables, projectId));
  // Exports copy the live version, so a site that was never published has nothing to export yet.
  const project = useProject(projectId);
  const deployments = useDeployments(projectId);
  const hasLiveVersion = liveVersionKnown(
    project.data?.hasPublishedVersion,
    deployments.data ? deployments.data.some((deployment) => deployment.status === 'READY') : undefined,
  );
  const manual = manualExport({ canCreate, hasLiveVersion });
  const createHintId = useId();
  // The one-time export form of this site is a view; null while another surface shows or once the section is gone.
  const createView = useRef<object | null>(null);
  useEffect(() => {
    if (surface !== 'create') return;
    const current = { projectId };
    createView.current = current;
    return () => {
      if (createView.current === current) createView.current = null;
    };
  }, [projectId, surface]);
  /**
   * Queues the selected formats for this site. A queued export is reported even after the person
   * leaves, since it really was queued; a refusal only while the form it was sent from still shows.
   */
  const createExport = async () => {
    if (manual.unavailable) return;
    const startedIn = createView.current;
    try {
      if ((await createRun({ projectId, formats })) !== 'busy') toast.success(t('settings.exports.workflow.queued'));
    } catch (error) {
      if (startedIn && createView.current === startedIn)
        toast.error(friendlyErrorMessage(t, error, 'settings.exports.workflow.startError', exportStartErrorKeys(hasLiveVersion)));
    }
  };

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
            onClick={() => {
              if (value !== surface) void leaveScheduleDraft(() => setSurface(value));
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
                  <Switch
                    checked={formats.includes(format)}
                    id={`export-format-${format}`}
                    onCheckedChange={() => setFormats((current) => toggleExportFormat(current, format))}
                  />
                  <Label htmlFor={`export-format-${format}`}>{t(labelKeys[format])}</Label>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs" id={createHintId}>
                {t(manual.hint)}
              </p>
              {/* Unavailable, not `disabled`: it stays in the tab order, and its reason (the hint) is read with it.
                  It looks like a disabled button too: dimmed, and no hover darkening or press movement. */}
              <Button
                aria-describedby={manual.unavailable ? createHintId : undefined}
                aria-disabled={manual.unavailable || undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-primary aria-disabled:active:not-aria-[haspopup]:translate-y-0"
                focusableWhenDisabled
                loading={creating}
                onClick={() => void createExport()}
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
                onClick={() => {
                  if (showSchedule) void leaveScheduleDraft(() => setShowSchedule(false));
                  else showScheduleDraft(true);
                }}
                size="sm"
                variant="outline"
              >
                <Plus className="size-3.5" /> {t('settings.exports.workflow.newSchedule')}
              </Button>
            ) : null}
          </div>
          {showSchedule && canManageSchedules ? (
            <ScheduleCreateForm
              onCreated={() => showScheduleDraft(false)}
              onDraftChange={nextScheduleDraft}
              onUnsettledChange={setScheduleUnsettled}
              projectId={projectId}
            />
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
              <ExportRunRow canCreate={canCreate} key={run.id} projectId={projectId} run={run} />
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
