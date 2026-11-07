import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), find: vi.fn(), update: vi.fn(), notify: vi.fn(), enqueue: vi.fn(), getJob: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: { $queryRaw: mocks.read, deployment: { findMany: mocks.find, updateMany: mocks.update } } }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.enqueue, getJob: mocks.getJob, QueueNames: { PUBLISH: 'publish' } }));
vi.mock('./lib/notify', () => ({ notifyDeployment: mocks.notify }));

import { reapStaleDeployments } from './reaper';

describe('publish recovery boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.update.mockResolvedValue({ count: 0 });
    mocks.find.mockResolvedValue([]);
    mocks.read.mockResolvedValue([]);
    mocks.getJob.mockResolvedValue(undefined);
  });

  it('finalizes a stranded retry and sends its failure notice only once across sweeps', async () => {
    let completedAt: Date | null = null;
    const stranded = { id: 'failed-retry', projectId: 'project', version: 4, error: 'Build failed', project: { name: 'Synthetic' } };
    mocks.find.mockImplementation(async () => (completedAt ? [] : [stranded]));
    mocks.update.mockImplementation(async ({ where, data }) => {
      if (where.id !== stranded.id || completedAt) return { count: 0 };
      completedAt = data.completedAt;
      return { count: 1 };
    });
    expect(await reapStaleDeployments()).toBe(1);
    expect(completedAt).toBeInstanceOf(Date);
    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'FAILED', completedAt: null, createdAt: { gt: expect.any(Date), lt: expect.any(Date) } },
      }),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: stranded.id, status: 'FAILED', completedAt: null, createdAt: { gt: expect.any(Date), lt: expect.any(Date) } },
      data: { completedAt: expect.any(Date) },
    });
    await reapStaleDeployments();
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenCalledWith({
      deploymentId: stranded.id,
      projectId: 'project',
      projectName: 'Synthetic',
      version: 4,
      outcome: 'failed',
      error: 'Build failed',
    });
  });

  it('does not finalize or notify a legacy FAILED row outside the recovery window', async () => {
    const legacy = {
      id: 'legacy',
      projectId: 'project',
      version: 1,
      error: 'Old failure',
      project: { name: 'Synthetic' },
      createdAt: new Date(Date.now() - 2 * 86_400_000),
    };
    mocks.find.mockImplementation(async ({ where }) =>
      (!where.createdAt.gt || legacy.createdAt > where.createdAt.gt) && legacy.createdAt < where.createdAt.lt ? [legacy] : [],
    );
    await reapStaleDeployments();
    expect(mocks.update.mock.calls.some(([query]) => query.where.id === legacy.id)).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('does not announce a stale failure when the worker has already reclaimed it', async () => {
    mocks.find.mockResolvedValue([{ id: 'retry', projectId: 'project', version: 4, error: null, project: { name: 'Synthetic' } }]);
    // The FAILED/null compare-and-set loses to the worker's BUILDING claim.
    mocks.update.mockResolvedValue({ count: 0 });
    await reapStaleDeployments();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('asks PostgreSQL only for recent, unreceipted, latest READY rows; historical rows never enter the queue', async () => {
    const old = { id: 'old', projectId: 'project', completedAt: new Date(Date.now() - 2 * 86_400_000) };
    mocks.read.mockImplementation(async (parts: TemplateStringsArray, since: Date, until: Date) => {
      const sql = parts.join('?');
      expect(sql).toContain('d."completedAt" > ? AND d."completedAt" < ?');
      expect(sql).toContain('newer.version > d.version');
      expect(sql).toContain("e.id = 'publish-ready:' || d.id");
      expect(Date.now() - since.getTime()).toBeCloseTo(86_400_000, -3);
      expect(until.getTime()).toBeGreaterThan(since.getTime());
      return old.completedAt > since && old.completedAt < until ? [old] : [];
    });
    await reapStaleDeployments();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('backfills historical completion times and receipts without a destructive rollback', () => {
    const root = new URL('../../../packages/database/prisma/migrations/20261107110000_publish_delivery_backfill/', import.meta.url);
    const migration = readFileSync(new URL('migration.sql', root), 'utf8');
    const rollback = readFileSync(new URL('rollback.sql', root), 'utf8');
    expect(migration).toContain('WHERE d."status" = \'READY\'');
    expect(migration).toContain('ON CONFLICT ("id") DO NOTHING');
    expect(migration).toContain("'publish_delivery_backfilled'");
    expect(migration).not.toContain("'auto'");
    expect(migration).toContain('d."completedAt"');
    expect(migration).not.toContain('now()');
    expect(migration).toContain('SET "completedAt" = "createdAt"');
    expect(migration).toContain('"status" = \'FAILED\' AND "completedAt" IS NULL');
    expect(rollback.replace(/--[^\n]*/g, '').trim()).toBe('');
  });
});
