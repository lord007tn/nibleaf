import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { QueueNames } from './constants';
import { ensurePlatformSchedules, PLATFORM_SCHEDULES, type ScheduleQueue } from './schedules';
import { QUEUE_CONFIGS } from './utils/queue';

function fixture(queueName: 'analytics' | 'export' = 'analytics', migrated = true) {
  const entries = new Map<string, Record<string, unknown>>();
  if (migrated) {
    for (const schedule of PLATFORM_SCHEDULES.filter((item) => item.queue === queueName)) {
      entries.set(schedule.id, {
        key: schedule.id,
        name: schedule.name,
        pattern: schedule.pattern,
        tz: 'UTC',
        template: {
          data: queueName === 'export' ? { requestedAt: '2026-01-01T00:00:00.000Z' } : {},
          opts: QUEUE_CONFIGS[queueName].defaultJobOptions,
        },
      });
    }
  }
  const queue = {
    getJobSchedulers: vi.fn(async () => [...entries.values()]),
    upsertJobScheduler: vi.fn(async (id: string, repeat: object, template: { name: string; data: object; opts: object }) => {
      entries.set(id, { key: id, name: template.name, ...repeat, template: { data: template.data, opts: template.opts } });
    }),
  };
  return { entries, queue, client: queue as unknown as ScheduleQueue };
}

describe('BullMQ 6 platform schedulers', () => {
  it.each([QueueNames.ANALYTICS, QueueNames.EXPORT])('preserves migrated %s IDs, cron and retry/retention options across startup', async (name) => {
    const state = fixture(name);
    const before = [...state.entries.values()].map(({ template: _template, ...entry }) => entry);
    await ensurePlatformSchedules(state.client, name);
    await ensurePlatformSchedules(state.client, name);
    expect([...state.entries.values()].map(({ template: _template, ...entry }) => entry)).toEqual(before);
    for (const call of state.queue.upsertJobScheduler.mock.calls) expect(call[2].opts).toEqual(QUEUE_CONFIGS[name].defaultJobOptions);
    expect(state.entries.size).toBe(2);
  });

  it('creates stable schedulers on a fresh queue without duplicates', async () => {
    const state = fixture('analytics', false);
    await ensurePlatformSchedules(state.client, QueueNames.ANALYTICS);
    await ensurePlatformSchedules(state.client, QueueNames.ANALYTICS);
    expect([...state.entries.keys()]).toEqual(['rollup-analytics-daily', 'reconcile-usage-periods']);
  });

  it.each(['c17471239c4ca8e84f5a9539f52deaca', 'unknown-scheduler'])('refuses unmigrated or unknown entry %s before writes', async (key) => {
    const state = fixture();
    state.entries.set(key, { key, name: 'rollup-analytics', pattern: '10 0 * * *', tz: 'UTC' });
    await expect(ensurePlatformSchedules(state.client, QueueNames.ANALYTICS)).rejects.toThrow('retained staged v5 image');
    expect(state.queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it.each([{ pattern: '* * * * *' }, { tz: 'Europe/Paris' }, { limit: 1 }, { every: 1000 }, { offset: 1 }])(
    'refuses modified schedule %j',
    async (change) => {
      const state = fixture();
      const entry = state.entries.get('reconcile-usage-periods');
      assert.ok(entry);
      Object.assign(entry, change);
      await expect(ensurePlatformSchedules(state.client, QueueNames.ANALYTICS)).rejects.toThrow('configuration');
      expect(state.queue.upsertJobScheduler).not.toHaveBeenCalled();
    },
  );

  it('refuses unexpected migrated job options before any scheduler update', async () => {
    const state = fixture();
    const entry = state.entries.get('reconcile-usage-periods');
    assert.ok(entry);
    entry.template = { data: {}, opts: { ...QUEUE_CONFIGS.analytics.defaultJobOptions, attempts: 99 } };
    await expect(ensurePlatformSchedules(state.client, QueueNames.ANALYTICS)).rejects.toThrow('job options');
    expect(state.queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('refuses malformed export data', async () => {
    const state = fixture('export');
    const entry = state.entries.get('cleanup-exports');
    assert.ok(entry);
    entry.template = { data: { requestedAt: 'invalid' }, opts: QUEUE_CONFIGS.export.defaultJobOptions };
    await expect(ensurePlatformSchedules(state.client, QueueNames.EXPORT)).rejects.toThrow('schedule data');
    expect(state.queue.upsertJobScheduler).not.toHaveBeenCalled();
  });
});
