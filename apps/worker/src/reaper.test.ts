import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn(), enqueue: vi.fn(), getJob: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: { $queryRaw: mocks.read, deployment: { updateMany: mocks.update } } }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.enqueue, getJob: mocks.getJob, QueueNames: { PUBLISH: 'publish' } }));

import { reapStaleDeployments } from './reaper';

describe('publish recovery boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.update.mockResolvedValue({ count: 0 });
    mocks.getJob.mockResolvedValue(undefined);
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

  it('backfills administrative receipts and rolls back only the markers owned by this migration', () => {
    const root = new URL('../../../packages/database/prisma/migrations/20261107110000_publish_delivery_backfill/', import.meta.url);
    const migration = readFileSync(new URL('migration.sql', root), 'utf8');
    const rollback = readFileSync(new URL('rollback.sql', root), 'utf8');
    expect(migration).toContain('WHERE d."status" = \'READY\'');
    expect(migration).toContain('ON CONFLICT ("id") DO NOTHING');
    expect(migration).toContain("'publish_delivery_backfilled'");
    expect(migration).not.toContain("'auto'");
    expect(rollback).toContain('"type" = \'publish_delivery_backfilled\'');
    expect(rollback).toContain("\"metadata\"->>'backfillMigration' = '20261107110000_publish_delivery_backfill'");
  });
});
