import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '@nibleaf/database';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), getJob: vi.fn(), QueueNames: { PUBLISH: 'publish' } }));
vi.mock('./lib/notify', () => ({ notifyDeployment: mocks.notify }));

import { finalizeAbandonedRetries, findRecoverableDeployments } from './reaper';

// Run through the shared-services nibleaf-audit-test wrapper, never the dogfood DB.
it.skipIf(process.env.ACTIVATION_INTEGRATION !== '1')(
  'executes the recovery query in PostgreSQL and excludes historical, receipted, fresh and superseded deliveries',
  async () => {
    const run = randomUUID();
    const now = new Date();
    const rollback = new Error('Rollback synthetic recovery fixtures');
    try {
      await expect(
        prisma.$transaction(
          async (tx) => {
            const ready = (name: string, minutesAgo: number) => ({
              id: `${run}-${name}`,
              projectId: `${run}-${name}`,
              version: 1,
              status: 'READY' as const,
              snapshot: {},
              completedAt: new Date(now.getTime() - minutesAgo * 60_000),
            });
            const old = ready('old', 2 * 24 * 60);
            const recent = ready('recent', 2);
            const receipted = ready('receipted', 2);
            const superseded = ready('superseded', 2);
            const fresh = ready('fresh', 0.5);
            const rows = [old, recent, receipted, superseded, fresh];
            const projects = rows.map((row) => row.projectId);
            await tx.organization.createMany({ data: projects.map((id) => ({ id, name: 'Synthetic recovery QA' })) });
            await tx.project.createMany({ data: projects.map((id) => ({ id, organizationId: id, name: 'Synthetic recovery QA', slug: id })) });
            const newer = { ...superseded, id: `${run}-newer`, version: 2, completedAt: new Date(now.getTime() - 30_000) };
            await tx.deployment.createMany({ data: [...rows, newer] });
            await tx.platformEvent.create({ data: { id: `publish-ready:${receipted.id}`, type: 'publish_ready', projectId: receipted.projectId } });
            const ownCandidates = () => findRecoverableDeployments(tx, now, projects);
            expect(await ownCandidates()).toEqual([{ id: recent.id, projectId: recent.projectId }]);
            await tx.platformEvent.create({ data: { id: `publish-ready:${recent.id}`, type: 'publish_ready', projectId: recent.projectId } });
            expect(await ownCandidates()).toEqual([]);
            throw rollback;
          },
          { timeout: 30_000 },
        ),
      ).rejects.toBe(rollback);
    } finally {
      await prisma.$disconnect();
    }
  },
  40_000,
);

it.skipIf(process.env.ACTIVATION_INTEGRATION !== '1')(
  'keeps legacy FAILED rows silent and conditionally finalizes an abandoned retry with one notice in PostgreSQL',
  async () => {
    const run = randomUUID();
    const now = new Date();
    const rollback = new Error('Rollback synthetic retry fixtures');
    mocks.notify.mockClear();
    try {
      await expect(
        prisma.$transaction(
          async (tx) => {
            await tx.organization.create({ data: { id: run, name: 'Synthetic retry QA' } });
            await tx.project.create({ data: { id: run, organizationId: run, name: 'Synthetic retry QA', slug: run } });
            const legacyId = `${run}-legacy`;
            const retryId = `${run}-retry`;
            const freshId = `${run}-fresh`;
            await tx.deployment.createMany({
              data: [
                { id: legacyId, projectId: run, version: 1, status: 'FAILED', createdAt: new Date(now.getTime() - 2 * 86_400_000) },
                {
                  id: retryId,
                  projectId: run,
                  version: 2,
                  status: 'FAILED',
                  createdAt: new Date(now.getTime() - 20 * 60_000),
                  error: 'Synthetic failure',
                },
                { id: freshId, projectId: run, version: 3, status: 'FAILED', createdAt: new Date(now.getTime() - 5 * 60_000) },
              ],
            });
            expect(await finalizeAbandonedRetries(tx, 15, now, [run])).toBe(2);
            expect(await finalizeAbandonedRetries(tx, 15, now, [run])).toBe(0);
            expect(await tx.deployment.findUnique({ where: { id: legacyId }, select: { completedAt: true } })).toEqual({ completedAt: now });
            expect(await tx.deployment.findUnique({ where: { id: freshId }, select: { completedAt: true } })).toEqual({ completedAt: null });
            expect(await tx.deployment.findUnique({ where: { id: retryId }, select: { completedAt: true } })).toEqual({ completedAt: now });
            const ownNotices = mocks.notify.mock.calls.filter(([notice]) => notice.projectId === run);
            expect(ownNotices).toEqual([[expect.objectContaining({ deploymentId: retryId, version: 2, outcome: 'failed' })]]);
            const backfillId = `${run}-backfill`;
            await tx.deployment.create({ data: { id: backfillId, projectId: run, version: 4, status: 'FAILED' } });
            const migration = readFileSync(
              new URL('../../../packages/database/prisma/migrations/20261107110000_publish_delivery_backfill/migration.sql', import.meta.url),
              'utf8',
            );
            for (const statement of migration.split(';').filter((part) => part.trim())) await tx.$executeRawUnsafe(statement);
            const backfilled = await tx.deployment.findUniqueOrThrow({ where: { id: backfillId } });
            expect(backfilled.completedAt).toEqual(backfilled.createdAt);
            expect(await tx.deployment.findUnique({ where: { id: retryId }, select: { completedAt: true } })).toEqual({ completedAt: now });
            throw rollback;
          },
          { timeout: 30_000 },
        ),
      ).rejects.toBe(rollback);
    } finally {
      await prisma.$disconnect();
    }
  },
  40_000,
);

it.skipIf(process.env.ACTIVATION_INTEGRATION !== '1')(
  'races two independent PostgreSQL connections and sends exactly one abandoned-retry notice',
  async () => {
    const run = randomUUID();
    const now = new Date();
    const retryId = `${run}-retry`;
    const backendIds = new Set<number>();
    let reads = 0;
    let releaseReads: () => void = () => undefined;
    const bothRead = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    // Release a surviving reader if its peer fails, so cleanup never hangs.
    const timeout = setTimeout(() => releaseReads(), 10_000);
    mocks.notify.mockClear();
    try {
      await prisma.organization.create({
        data: { id: run, name: 'Synthetic finalizer race QA', projects: { create: { id: run, name: 'Synthetic', slug: run } } },
      });
      await prisma.deployment.create({
        data: { id: retryId, projectId: run, version: 1, status: 'FAILED', createdAt: new Date(now.getTime() - 20 * 60_000) },
      });
      const race = () =>
        prisma.$transaction(
          async (tx) => {
            const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
            if (!backend) throw new Error('Missing PostgreSQL backend id');
            backendIds.add(backend.pid);
            const db = {
              deployment: new Proxy(tx.deployment, {
                get(target, key) {
                  if (key !== 'findMany') return Reflect.get(target, key);
                  return async (args: Parameters<typeof target.findMany>[0]) => {
                    const rows = await target.findMany(args);
                    expect(rows.map((row) => row.id)).toEqual([retryId]);
                    reads += 1;
                    if (reads === 2) releaseReads();
                    await bothRead;
                    return rows;
                  };
                },
              }),
            };
            return finalizeAbandonedRetries(db, 15, now, [run]);
          },
          { timeout: 30_000 },
        );
      const results = await Promise.allSettled([race(), race()]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      expect(backendIds.size).toBe(2);
      expect(reads).toBe(2);
      expect(results.map((result) => (result.status === 'fulfilled' ? result.value : -1)).sort()).toEqual([0, 1]);
      expect(mocks.notify.mock.calls.filter(([notice]) => notice.projectId === run)).toEqual([
        [expect.objectContaining({ deploymentId: retryId, outcome: 'failed' })],
      ]);
      expect(await finalizeAbandonedRetries(prisma, 15, now, [run])).toBe(0);
      expect(mocks.notify).toHaveBeenCalledOnce();
      expect(await prisma.deployment.findUnique({ where: { id: retryId }, select: { completedAt: true } })).toEqual({ completedAt: now });
    } finally {
      clearTimeout(timeout);
      releaseReads();
      await prisma.project.deleteMany({ where: { organizationId: run } });
      await prisma.organization.deleteMany({ where: { id: run } });
      await prisma.$disconnect();
    }
  },
  40_000,
);
