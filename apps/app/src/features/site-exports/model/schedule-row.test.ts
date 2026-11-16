import { describe, expect, it } from 'vitest';
import {
  exportStartErrorKeys,
  isScheduleRequest,
  type ScheduleRowSource,
  scheduleEnabledRequest,
  scheduleRow,
  scheduleRunRequest,
} from './schedule-row';

const schedule = (overrides: Partial<ScheduleRowSource> = {}): ScheduleRowSource => ({
  id: 'schedule-1',
  name: 'Daily backup',
  cadence: 'DAILY',
  timezone: 'Africa/Tunis',
  hour: 2,
  minute: 5,
  enabled: true,
  nextRunAt: '2026-11-17T01:05:00.000Z',
  lastError: null,
  _count: { jobs: 3 },
  ...overrides,
});
const idle = { run: [], enabled: [] };

describe('scheduleRow', () => {
  it('describes the schedule as the server last returned it', () => {
    const row = scheduleRow('site-a', schedule({ lastError: 'No published revision is available.' }), { canManage: false, pending: idle });
    expect(row).toEqual({
      name: 'Daily backup',
      status: 'settings.exports.workflow.enabled',
      cadence: 'settings.exports.workflow.daily',
      time: '02:05',
      timezone: 'Africa/Tunis',
      nextRunAt: '2026-11-17T01:05:00.000Z',
      runCount: 3,
      lastError: 'No published revision is available.',
      actions: null,
    });
  });

  it.each([
    ['WEEKLY', 'settings.exports.workflow.weekly'],
    ['MONTHLY', 'settings.exports.workflow.monthly'],
  ] as const)('names a %s cadence', (cadence, key) => {
    expect(scheduleRow('site-a', schedule({ cadence }), { canManage: false, pending: idle }).cadence).toBe(key);
  });

  it('hides every management action from people who cannot manage schedules', () => {
    const pending = { run: [{ projectId: 'site-a', scheduleId: 'schedule-1' }], enabled: [] };
    expect(scheduleRow('site-a', schedule(), { canManage: false, pending }).actions).toBeNull();
  });

  it('offers Run now and the opposite of the current state, idle when nothing is pending', () => {
    expect(scheduleRow('site-a', schedule(), { canManage: true, pending: idle }).actions).toEqual({
      run: { label: 'settings.exports.workflow.runNow', busy: false },
      toggle: { label: 'settings.exports.workflow.disable', busy: false },
    });
    const off = scheduleRow('site-a', schedule({ enabled: false }), { canManage: true, pending: idle });
    expect(off.status).toBe('settings.exports.workflow.disabled');
    expect(off.actions?.toggle.label).toBe('settings.exports.workflow.enable');
  });

  it('is busy only for a pending request about this site and this schedule', () => {
    const pending = {
      run: [
        { projectId: 'site-b', scheduleId: 'schedule-1' },
        { projectId: 'site-a', scheduleId: 'schedule-2' },
      ],
      enabled: [{ projectId: 'site-a', scheduleId: 'schedule-1', enabled: false }],
    };
    const actions = scheduleRow('site-a', schedule(), { canManage: true, pending }).actions;
    expect(actions?.run.busy).toBe(false);
    expect(actions?.toggle.busy).toBe(true);
    expect(scheduleRow('site-a', schedule({ id: 'schedule-2' }), { canManage: true, pending }).actions?.run.busy).toBe(true);
  });
});

describe('schedule requests', () => {
  it('carry the site, the schedule and, for Enable/Disable, the value asked for', () => {
    expect(scheduleRunRequest('site-a', schedule())).toEqual({ projectId: 'site-a', scheduleId: 'schedule-1' });
    expect(scheduleEnabledRequest('site-a', schedule())).toEqual({ projectId: 'site-a', scheduleId: 'schedule-1', enabled: false });
    expect(scheduleEnabledRequest('site-a', schedule({ enabled: false }))).toEqual({ projectId: 'site-a', scheduleId: 'schedule-1', enabled: true });
  });

  it('match only the same site and schedule', () => {
    const request = { projectId: 'site-a', scheduleId: 'schedule-1' };
    expect(isScheduleRequest({ ...request, enabled: true }, request)).toBe(true);
    expect(isScheduleRequest({ projectId: 'site-b', scheduleId: 'schedule-1' }, request)).toBe(false);
    expect(isScheduleRequest({ projectId: 'site-a', scheduleId: 'schedule-2' }, request)).toBe(false);
    expect(isScheduleRequest(undefined, request)).toBe(false);
  });
});

describe('exportStartErrorKeys', () => {
  it('words a refused start by what is known about the live version', () => {
    expect(exportStartErrorKeys(true)).toEqual({ 409: 'settings.exports.workflow.limitReached', 400: 'settings.exports.workflow.tooLarge' });
    expect(exportStartErrorKeys(false)[400]).toBe('settings.exports.workflow.publishFirst');
    expect(exportStartErrorKeys(undefined)[400]).toBe('settings.exports.workflow.publishFirst');
  });
});
