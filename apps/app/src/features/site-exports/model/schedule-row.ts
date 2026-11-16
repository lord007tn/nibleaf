/**
 * One export schedule in the list, as pure logic: what the row says about the
 * schedule and which actions it offers. Rendered by
 * `components/schedule-row.tsx`; tested in `schedule-row.test.ts`.
 *
 * The server stays the authority. The row shows the schedule as last read,
 * offers its actions only to people who manage schedules, and an action is
 * busy only while a request for this site and this schedule is pending.
 */
import type { MessageKey } from '@nibleaf/i18n';

/** The fields of a listed schedule that the row reads. */
export type ScheduleRowSource = {
  id: string;
  name: string;
  cadence: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  timezone: string;
  hour: number;
  minute: number;
  enabled: boolean;
  nextRunAt: string | null;
  lastError: string | null;
  _count: { jobs: number };
};

/** A request about one schedule. It names the site it was sent for, whatever the page shows by the time it settles. */
export type ScheduleRequest = { projectId: string; scheduleId: string };
/** Turns a schedule on or off. `enabled` is the value asked for; nothing else is sent. */
export type ScheduleEnabledRequest = ScheduleRequest & { enabled: boolean };

const CADENCE_LABELS: Record<ScheduleRowSource['cadence'], MessageKey> = {
  DAILY: 'settings.exports.workflow.daily',
  WEEKLY: 'settings.exports.workflow.weekly',
  MONTHLY: 'settings.exports.workflow.monthly',
};

/**
 * What a refused export start means, for a one-time export and for Run now.
 * 409: too many exports running, or today's limit reached. 400 once a version
 * is known to be live: that version is larger than this instance exports
 * (retrying won't help); otherwise the site was never published.
 */
export const exportStartErrorKeys = (hasLiveVersion: boolean | undefined): Partial<Record<number, MessageKey>> => ({
  409: 'settings.exports.workflow.limitReached',
  400: hasLiveVersion ? 'settings.exports.workflow.tooLarge' : 'settings.exports.workflow.publishFirst',
});

/** Whether a pending request (as the mutation cache holds it) is about this site's schedule. */
export const isScheduleRequest = (variables: unknown, { projectId, scheduleId }: ScheduleRequest): boolean =>
  typeof variables === 'object' &&
  variables !== null &&
  (variables as Partial<ScheduleRequest>).projectId === projectId &&
  (variables as Partial<ScheduleRequest>).scheduleId === scheduleId;

/** Run now for this site's schedule. */
export const scheduleRunRequest = (projectId: string, schedule: Pick<ScheduleRowSource, 'id'>): ScheduleRequest => ({
  projectId,
  scheduleId: schedule.id,
});

/** Enable or Disable: the opposite of the value the row shows when it is pressed. */
export const scheduleEnabledRequest = (projectId: string, schedule: Pick<ScheduleRowSource, 'id' | 'enabled'>): ScheduleEnabledRequest => ({
  projectId,
  scheduleId: schedule.id,
  enabled: !schedule.enabled,
});

type ScheduleRowAction = { label: MessageKey; busy: boolean };

export type ScheduleRowModel = {
  name: string;
  /** "enabled" or "disabled", from the server's value. */
  status: MessageKey;
  cadence: MessageKey;
  /** The local run time, "HH:MM". */
  time: string;
  timezone: string;
  nextRunAt: string | null;
  runCount: number;
  lastError: string | null;
  /** Null for people who can't manage schedules: the controls are hidden, not disabled. */
  actions: { run: ScheduleRowAction; toggle: ScheduleRowAction } | null;
};

/**
 * The row for one schedule. `pending` lists the requests still in flight for
 * every row; only those for this site and this schedule make its actions busy,
 * so one row's request never locks another.
 */
export function scheduleRow(
  projectId: string,
  schedule: ScheduleRowSource,
  { canManage, pending }: { canManage: boolean; pending: { run: readonly unknown[]; enabled: readonly unknown[] } },
): ScheduleRowModel {
  const request = scheduleRunRequest(projectId, schedule);
  const busy = (requests: readonly unknown[]) => requests.some((variables) => isScheduleRequest(variables, request));
  return {
    name: schedule.name,
    status: schedule.enabled ? 'settings.exports.workflow.enabled' : 'settings.exports.workflow.disabled',
    cadence: CADENCE_LABELS[schedule.cadence],
    time: `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`,
    timezone: schedule.timezone,
    nextRunAt: schedule.nextRunAt,
    runCount: schedule._count.jobs,
    lastError: schedule.lastError,
    actions: canManage
      ? {
          run: { label: 'settings.exports.workflow.runNow', busy: busy(pending.run) },
          toggle: {
            label: schedule.enabled ? 'settings.exports.workflow.disable' : 'settings.exports.workflow.enable',
            busy: busy(pending.enabled),
          },
        }
      : null,
  };
}
