import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { CheckboxField } from '@nibleaf/design-system/components/ui/checkbox';
import { DataList, DataListEmpty, DataListSkeleton } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { SettingsSection, SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
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
import { useConfirmSettingsDiscard } from './shared';

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
  // The new-schedule draft is unsettled while it differs from its defaults or its creation is pending.
  // Closing it asks first, as leaving the page does.
  const scheduleUnsettled = useRef(false);
  const setScheduleUnsettled = useCallback((unsettled: boolean) => {
    scheduleUnsettled.current = unsettled;
  }, []);
  const confirmDiscard = useConfirmSettingsDiscard();
  // Which draft a leave confirmation is about. It moves on whenever the form opens or closes (a
  // creation closes it too), or the form starts or ends a draft itself (it
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
  // The one-time export form of this site is a view; null once the page is gone.
  const createView = useRef<object | null>(null);
  useEffect(() => {
    const current = { projectId };
    createView.current = current;
    return () => {
      if (createView.current === current) createView.current = null;
    };
  }, [projectId]);
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

  const loading = <DataListSkeleton loadingLabel={t('common.loading')} rows={2} />;
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader description={t('settings.exports.description')} title={t('settings.exports.title')} />
      {runs.isError || schedules.isError ? <Callout tone="danger">{t('settings.exports.workflow.loadError')}</Callout> : null}

      <SettingsSection
        description={t('settings.exports.workflow.oneTimeDesc')}
        footer={
          <p className="text-xs">
            {t('settings.exports.workflow.legacyPrompt')}{' '}
            <a className="underline underline-offset-2 hover:text-foreground" download href={`/api/app/projects/${projectId}/export`}>
              {t('settings.exports.workflow.legacyDownload')}
            </a>
            {' · '}
            <a className="underline underline-offset-2 hover:text-foreground" download href={`/api/app/projects/${projectId}/theme-repository`}>
              {t('settings.exports.downloadRepository')}
            </a>
          </p>
        }
        title={t('settings.exports.workflow.oneTime')}
      >
        <SettingsSectionBody className="flex flex-col gap-4">
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-3 font-medium text-sm">{t('settings.exports.formats')}</legend>
            {(Object.keys(labelKeys) as ExportFormat[]).map((format) => {
              const checked = formats.includes(format);
              return (
                <CheckboxField
                  checked={checked}
                  // The last ticked format can't be unticked: an export needs one.
                  disabledReason={checked && formats.length === 1 ? t('settings.exports.workflow.formatMinimum') : undefined}
                  id={`export-format-${format}`}
                  key={format}
                  label={t(labelKeys[format])}
                  onCheckedChange={() => setFormats((current) => toggleExportFormat(current, format))}
                />
              );
            })}
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 basis-64 text-muted-foreground text-xs" id={createHintId}>
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
        </SettingsSectionBody>
      </SettingsSection>

      <SettingsSection description={t('settings.exports.workflow.historyDesc')} title={t('settings.exports.workflow.history')}>
        {runs.isPending ? loading : null}
        {runs.data?.length ? (
          <DataList aria-label={t('settings.exports.workflow.history')}>
            {runs.data.map((run) => (
              <ExportRunRow canCreate={canCreate} key={run.id} projectId={projectId} run={run} />
            ))}
          </DataList>
        ) : null}
        {!runs.isPending && !runs.data?.length ? (
          <DataListEmpty>
            <EmptyState
              description={t('settings.exports.workflow.noRunsDesc')}
              icon={<FileArchive />}
              size="section"
              title={t('settings.exports.workflow.noRuns')}
            />
          </DataListEmpty>
        ) : null}
      </SettingsSection>

      <SettingsSection
        actions={
          canManageSchedules ? (
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
          ) : null
        }
        description={t('settings.exports.workflow.schedulesDesc')}
        title={t('settings.exports.workflow.schedules')}
      >
        {showSchedule && canManageSchedules ? (
          <SettingsSectionBody>
            <ScheduleCreateForm
              onCreated={() => showScheduleDraft(false)}
              onDraftChange={nextScheduleDraft}
              onUnsettledChange={setScheduleUnsettled}
              projectId={projectId}
            />
          </SettingsSectionBody>
        ) : null}
        {schedules.isPending ? loading : null}
        {schedules.data?.length ? (
          <DataList aria-label={t('settings.exports.workflow.schedules')}>
            {schedules.data.map((schedule) => (
              <ScheduleRow
                canManage={canManageSchedules}
                hasLiveVersion={hasLiveVersion}
                key={schedule.id}
                projectId={projectId}
                schedule={schedule}
              />
            ))}
          </DataList>
        ) : null}
        {!schedules.isPending && !schedules.data?.length ? (
          <DataListEmpty>
            <EmptyState
              description={t('settings.exports.workflow.noSchedulesDesc')}
              icon={<Archive />}
              size="section"
              title={t('settings.exports.workflow.noSchedules')}
            />
          </DataListEmpty>
        ) : null}
      </SettingsSection>
    </div>
  );
}
