import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useLocale } from '@nibleaf/i18n/react';
import { Play } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { FailureMessage } from '@/components/failure-message';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { localeTag } from '@/lib/format';
import { usePendingScheduleRequests, useRunSchedule, useSetScheduleEnabled } from '../api/schedules';
import { exportStartErrorKeys, type ScheduleRowSource, scheduleEnabledRequest, scheduleRow, scheduleRunRequest } from '../model/schedule-row';

/** A date in the reader's language, or a dash when there is none. */
export const formatExportDate = (date: string | null, locale: string) => (date ? new Date(date).toLocaleString(localeTag(locale)) : '—');

/**
 * One export schedule: when it runs, how many runs it has had, its last failure and,
 * for people who manage schedules, Run now and Enable/Disable. Both write at
 * once and show the server's value: nothing changes on screen until the
 * server answers, and a refused change leaves the value as it was read.
 *
 * A request belongs to the site and schedule it was sent for. A queued run is
 * reported even if this row is gone by then, since the run really was queued.
 * A failure is reported only while the row still shows the view it started in;
 * nothing ever moves focus.
 */
export function ScheduleRow({
  projectId,
  schedule,
  canManage,
  hasLiveVersion,
}: {
  projectId: string;
  schedule: ScheduleRowSource;
  canManage: boolean;
  hasLiveVersion: boolean | undefined;
}) {
  const { locale, t } = useLocale();
  const setEnabled = useSetScheduleEnabled();
  const runSchedule = useRunSchedule();
  const row = scheduleRow(projectId, schedule, { canManage, pending: usePendingScheduleRequests() });
  // Each site and schedule the row shows is a new view, even one it showed before (A → B → A); null once it is gone.
  const view = useRef<object | null>(null);
  useEffect(() => {
    const current = { projectId, scheduleId: schedule.id };
    view.current = current;
    return () => {
      if (view.current === current) view.current = null;
    };
  }, [projectId, schedule.id]);

  const runNow = async () => {
    const startedIn = view.current;
    try {
      if ((await runSchedule(scheduleRunRequest(projectId, schedule))) !== 'busy') toast.success(t('settings.exports.workflow.runQueued'));
    } catch (error) {
      if (startedIn && view.current === startedIn)
        toast.error(friendlyErrorMessage(t, error, 'settings.exports.workflow.startError', exportStartErrorKeys(hasLiveVersion)));
    }
  };
  const toggle = async () => {
    const startedIn = view.current;
    try {
      await setEnabled(scheduleEnabledRequest(projectId, schedule));
    } catch (error) {
      if (startedIn && view.current === startedIn) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium text-sm">
          <span dir="auto">{row.name}</span>
          <Badge variant="secondary">{t(row.status)}</Badge>
        </div>
        <div className="mt-1 text-muted-foreground text-xs">
          {t(row.cadence)} {t('settings.exports.workflow.at')}{' '}
          <span dir="ltr">
            {row.time} {row.timezone}
          </span>{' '}
          · {t('settings.exports.workflow.next')} {formatExportDate(row.nextRunAt, locale)} ·{' '}
          {t('settings.exports.workflow.runCount', { count: row.runCount })}
        </div>
        {row.lastError ? <FailureMessage context="export" error={row.lastError} /> : null}
      </div>
      {row.actions ? (
        <div className="flex gap-2">
          {/* Busy keeps focus on the button (focusableWhenDisabled), so a keyboard press doesn't drop it to the page.
              The schedule's name completes each button's accessible name. */}
          <Button focusableWhenDisabled loading={row.actions.run.busy} onClick={() => void runNow()} size="sm" variant="outline">
            <Play aria-hidden className="size-3.5" /> {t(row.actions.run.label)}
            <span className="sr-only"> {row.name}</span>
          </Button>
          <Button focusableWhenDisabled loading={row.actions.toggle.busy} onClick={() => void toggle()} size="sm" variant="outline">
            {t(row.actions.toggle.label)}
            <span className="sr-only"> {row.name}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
