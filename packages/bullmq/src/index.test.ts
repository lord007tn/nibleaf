import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueNames } from './constants';

const { queueMocks } = vi.hoisted(() => ({
  queueMocks: {
    analytics: { add: vi.fn(), getJob: vi.fn(), upsertJobScheduler: vi.fn() },
    export: { add: vi.fn(), getJob: vi.fn(), upsertJobScheduler: vi.fn() },
  },
}));

vi.mock('./queues/index', () => ({
  queues: {
    [QueueNames.ANALYTICS]: queueMocks.analytics,
    [QueueNames.EXPORT]: queueMocks.export,
  },
}));

vi.mock('./utils/logger', () => ({
  queueLogger: { debug: vi.fn(), info: vi.fn() },
}));

import { scheduleAnalyticsRollup, scheduleExportMaintenance } from './index';

describe('BullMQ 6 job schedulers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts analytics schedulers with stable ids and UTC cron definitions', async () => {
    await scheduleAnalyticsRollup();

    expect(queueMocks.analytics.upsertJobScheduler).toHaveBeenNthCalledWith(
      1,
      'rollup-analytics-daily',
      { pattern: '10 0 * * *', tz: 'UTC' },
      { name: 'rollup-analytics', data: {} },
    );
    expect(queueMocks.analytics.upsertJobScheduler).toHaveBeenNthCalledWith(
      2,
      'reconcile-usage-periods',
      { pattern: '*/5 * * * *', tz: 'UTC' },
      { name: 'reconcile-usage', data: {} },
    );
    expect(queueMocks.analytics.add).not.toHaveBeenCalled();
  });

  it('upserts export schedulers instead of removed repeatable-job options', async () => {
    await scheduleExportMaintenance();

    expect(queueMocks.export.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(queueMocks.export.upsertJobScheduler).toHaveBeenCalledWith(
      'dispatch-export-schedules',
      { pattern: '* * * * *', tz: 'UTC' },
      expect.objectContaining({ name: 'dispatch-export-schedules' }),
    );
    expect(queueMocks.export.upsertJobScheduler).toHaveBeenCalledWith(
      'cleanup-exports',
      { pattern: '17 2 * * *', tz: 'UTC' },
      expect.objectContaining({ name: 'cleanup-exports' }),
    );
    expect(queueMocks.export.add).not.toHaveBeenCalled();
  });
});
