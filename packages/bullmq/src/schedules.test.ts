import { describe, expect, it, vi } from 'vitest';
import { QueueNames } from './constants';
import { ensurePlatformSchedules, legacyScheduleKey, migratePlatformSchedules, PLATFORM_SCHEDULES, type ScheduleQueue } from './schedules';
import { QUEUE_CONFIGS } from './utils/queue';

function fixture(legacy = true) {
  const calls: string[] = [];
  const make = (queueName: 'analytics' | 'export') => {
    const entries = new Map<string, Record<string, unknown>>();
    const jobs = new Map<string, Record<string, unknown>>();
    const queue = {
      getJobSchedulers: vi.fn(async () => [...entries.values()]),
      getRepeatableJobs: vi.fn(async () => [...entries.values()]),
      getJob: vi.fn(async (id: string) => jobs.get(id)),
      isPaused: vi.fn(async () => true),
      getActiveCount: vi.fn(async () => 0),
      getWaitingCount: vi.fn(async () => 0),
      upsertJobScheduler: vi.fn(async (id: string, repeat: object, template: { name: string; data: object; opts: object }) => {
        calls.push(`upsert:${id}`);
        entries.set(id, { key: id, name: template.name, ...repeat, template: { data: template.data, opts: template.opts } });
      }),
      removeRepeatableByKey: vi.fn(async (key: string) => {
        calls.push(`remove-legacy:${key}`);
        return entries.delete(key);
      }),
      removeJobScheduler: vi.fn(async (id: string) => {
        calls.push(`remove-scheduler:${id}`);
        return entries.delete(id);
      }),
      add: vi.fn(async (name: string, data: object, opts: { jobId: string; repeat: object }) => {
        calls.push(`add:${opts.jobId}`);
        const schedule = PLATFORM_SCHEDULES.find((item) => item.id === opts.jobId);
        if (!schedule) throw new Error('Unexpected fixture job');
        const key = legacyScheduleKey(schedule);
        entries.set(key, { key, name, ...opts.repeat, next: 100 });
        jobs.set(`repeat:${key}:100`, {
          name,
          data,
          opts: { ...QUEUE_CONFIGS[queueName].defaultJobOptions, repeat: { ...opts.repeat, jobId: opts.jobId, count: 1 } },
        });
      }),
    };
    if (legacy) {
      for (const schedule of PLATFORM_SCHEDULES.filter((item) => item.queue === queueName)) {
        const key = legacyScheduleKey(schedule);
        const repeat = { pattern: schedule.pattern, tz: 'UTC', jobId: schedule.id, count: 1 };
        entries.set(key, { key, name: schedule.name, pattern: schedule.pattern, tz: 'UTC', next: 100 });
        jobs.set(`repeat:${key}:100`, {
          name: schedule.name,
          data: queueName === 'export' ? { requestedAt: '2026-01-01T00:00:00.000Z' } : {},
          opts: { ...QUEUE_CONFIGS[queueName].defaultJobOptions, repeat },
        });
      }
    }
    return { queue, entries, jobs };
  };
  const analytics = make('analytics');
  const exports = make('export');
  return {
    calls,
    analytics,
    exports,
    queues: { analytics: analytics.queue as unknown as ScheduleQueue, export: exports.queue as unknown as ScheduleQueue },
  };
}

describe('staged platform scheduler migration', () => {
  it('keeps a dry-run read-only', async () => {
    const state = fixture();
    const result = await migratePlatformSchedules(state.queues);
    expect(result.applied).toBe(false);
    expect(result.schedules).toHaveLength(4);
    expect(state.calls).toEqual([]);
  });

  it('does not create schedulers on startup alongside legacy jobs', async () => {
    const state = fixture();
    await ensurePlatformSchedules(state.queues.analytics, QueueNames.ANALYTICS);
    expect(state.calls).toEqual([]);
  });

  it('uses stable IDs on fresh and repeated startup', async () => {
    const state = fixture(false);
    await ensurePlatformSchedules(state.queues.analytics, QueueNames.ANALYTICS);
    await ensurePlatformSchedules(state.queues.analytics, QueueNames.ANALYTICS);
    expect([...state.analytics.entries.keys()]).toEqual(['rollup-analytics-daily', 'reconcile-usage-periods']);
  });

  it('refuses startup in partial migration state', async () => {
    const state = fixture();
    state.analytics.entries.set('rollup-analytics-daily', {
      key: 'rollup-analytics-daily',
      name: 'rollup-analytics',
      pattern: '10 0 * * *',
      tz: 'UTC',
      template: { data: {}, opts: QUEUE_CONFIGS.analytics.defaultJobOptions },
    });
    await expect(ensurePlatformSchedules(state.queues.analytics, QueueNames.ANALYTICS)).rejects.toThrow('Mixed legacy');
    expect(state.calls).toEqual([]);
  });

  it('creates and verifies all destinations before any removal, and reruns safely', async () => {
    const state = fixture();
    const first = await migratePlatformSchedules(state.queues, { apply: true });
    expect(state.calls.slice(0, 4).every((call) => call.startsWith('upsert:'))).toBe(true);
    expect(first.schedules.every((entry) => entry.scheduler && !entry.legacy)).toBe(true);
    const second = await migratePlatformSchedules(state.queues, { apply: true });
    expect(second.schedules).toEqual(first.schedules);
  });

  it('restores known legacy schedules before removing schedulers for rollback', async () => {
    const state = fixture();
    await migratePlatformSchedules(state.queues, { apply: true });
    state.calls.length = 0;
    const result = await migratePlatformSchedules(state.queues, { apply: true, rollback: true });
    expect(state.calls.slice(0, 4).every((call) => call.startsWith('add:'))).toBe(true);
    expect(result.schedules.every((entry) => entry.legacy && !entry.scheduler)).toBe(true);
    await migratePlatformSchedules(state.queues, { apply: true, rollback: true });
    await ensurePlatformSchedules(state.queues.analytics, QueueNames.ANALYTICS);
    expect([...state.analytics.entries.keys()]).not.toContain('rollup-analytics-daily');
  });

  it('rejects unknown entries across both queues before writes', async () => {
    const state = fixture();
    state.exports.entries.set('unknown', { key: 'unknown', name: 'unknown' });
    await expect(migratePlatformSchedules(state.queues, { apply: true })).rejects.toThrow('Unknown recurring');
    expect(state.calls).toEqual([]);
  });

  it('rejects mismatched cron or legacy options without deletion', async () => {
    const state = fixture();
    for (const job of state.exports.jobs.values()) job.opts = { repeat: { limit: 1 } };
    await expect(migratePlatformSchedules(state.queues, { apply: true })).rejects.toThrow('Unexpected legacy');
    expect(state.calls).toEqual([]);
  });

  it.each(['running', 'active', 'waiting'])('refuses an unsafe %s queue', async (condition) => {
    const state = fixture();
    if (condition === 'running') state.analytics.queue.isPaused.mockResolvedValue(false);
    if (condition === 'active') state.analytics.queue.getActiveCount.mockResolvedValue(1);
    if (condition === 'waiting') state.analytics.queue.getWaitingCount.mockResolvedValue(1);
    await expect(migratePlatformSchedules(state.queues, { apply: true })).rejects.toThrow('paused');
    expect(state.calls).toEqual([]);
  });

  it('retains all legacy definitions if destination verification fails', async () => {
    const state = fixture();
    state.exports.queue.upsertJobScheduler.mockImplementation(async () => undefined);
    await expect(migratePlatformSchedules(state.queues, { apply: true })).rejects.toThrow('verification');
    expect(state.calls.some((call) => call.startsWith('remove'))).toBe(false);
  });

  it('resumes safely after a partial removal failure', async () => {
    const state = fixture();
    state.exports.queue.removeRepeatableByKey.mockRejectedValueOnce(new Error('Disconnected'));
    await expect(migratePlatformSchedules(state.queues, { apply: true })).rejects.toThrow('Disconnected');
    const result = await migratePlatformSchedules(state.queues, { apply: true });
    expect(result.schedules.every((entry) => entry.scheduler && !entry.legacy)).toBe(true);
  });

  it('does not overwrite unexpected existing scheduler templates', async () => {
    const state = fixture(false);
    state.analytics.entries.set('rollup-analytics-daily', {
      key: 'rollup-analytics-daily',
      name: 'rollup-analytics',
      pattern: '10 0 * * *',
      tz: 'UTC',
      template: { data: {}, opts: { ...QUEUE_CONFIGS.analytics.defaultJobOptions, attempts: 99 } },
    });
    await expect(migratePlatformSchedules(state.queues, { apply: true })).rejects.toThrow('job options');
    expect(state.calls).toEqual([]);
  });
});
